import { redisService } from "./redis.service";
import { logger } from "@/server";

/**
 * Cache Hit Tracker Service
 * Tracks cache access patterns using Redis INCRBY for atomic counting
 * Used to detect hot cache keys that need pre-warming
 */
export class CacheHitTrackerService {
	private readonly hitKeyPrefix = "cache:hits:";
	private readonly thresholdKeyPrefix = "cache:threshold:";
	private readonly defaultThreshold = 100; // Prewarm if hits exceed this in window
	private readonly windowSeconds = 300; // 5 minutes tracking window

	/**
	 * Track cache hit atomically using INCRBY
	 * @param cacheKey - The cache key that was accessed
	 * @param isHit - Whether it was a cache hit or miss
	 */
	async trackAccess(cacheKey: string, isHit: boolean): Promise<void> {
		try {
			const hitKey = `${this.hitKeyPrefix}${cacheKey}`;
			const missKey = `${this.hitKeyPrefix}${cacheKey}:miss`;

			// Atomic increment using INCRBY
			if (isHit) {
				await redisService.incrBy(hitKey, 1);
			} else {
				await redisService.incrBy(missKey, 1);
			}

			// Set expiry on first access
			await redisService.expire(isHit ? hitKey : missKey, this.windowSeconds);
		} catch (error) {
			// Don't fail the request if tracking fails
			logger.warn({ error, cacheKey, isHit }, "Failed to track cache access");
		}
	}

	/**
	 * Get cache statistics for a specific key
	 */
	async getCacheStats(cacheKey: string): Promise<{
		hits: number;
		misses: number;
		hitRate: number;
	}> {
		try {
			const hitKey = `${this.hitKeyPrefix}${cacheKey}`;
			const missKey = `${this.hitKeyPrefix}${cacheKey}:miss`;

			const hitsStr = await redisService.get(hitKey);
			const missesStr = await redisService.get(missKey);

			const hits = hitsStr ? Number.parseInt(hitsStr, 10) : 0;
			const misses = missesStr ? Number.parseInt(missesStr, 10) : 0;
			const total = hits + misses;
			const hitRate = total > 0 ? (hits / total) * 100 : 0;

			return { hits, misses, hitRate };
		} catch (error) {
			logger.error({ error, cacheKey }, "Failed to get cache stats");
			return { hits: 0, misses: 0, hitRate: 0 };
		}
	}

	/**
	 * Check if a cache key needs pre-warming based on hit threshold
	 * @returns true if hits exceed threshold
	 */
	async needsPrewarming(cacheKey: string): Promise<boolean> {
		try {
			const stats = await this.getCacheStats(cacheKey);
			const threshold = await this.getThreshold(cacheKey);

			// Need prewarming if:
			// 1. High number of misses (low hit rate < 50%)
			// 2. High total access count (hits + misses > threshold)
			const totalAccess = stats.hits + stats.misses;
			const needsPrewarm = stats.hitRate < 50 && totalAccess > threshold;

			if (needsPrewarm) {
				logger.info({ cacheKey, stats, threshold }, "Cache key needs pre-warming based on access pattern");
			}

			return needsPrewarm;
		} catch (error) {
			logger.error({ error, cacheKey }, "Failed to check pre-warming need");
			return false;
		}
	}

	/**
	 * Get threshold for a specific cache key
	 */
	private async getThreshold(cacheKey: string): Promise<number> {
		try {
			const thresholdKey = `${this.thresholdKeyPrefix}${cacheKey}`;
			const value = await redisService.get(thresholdKey);
			return value ? Number.parseInt(value, 10) : this.defaultThreshold;
		} catch (error) {
			logger.error({ error, cacheKey }, "Failed to get threshold, using default");
			return this.defaultThreshold;
		}
	}

	/**
	 * Set custom threshold for specific cache key
	 */
	async setThreshold(cacheKey: string, threshold: number): Promise<void> {
		try {
			const thresholdKey = `${this.thresholdKeyPrefix}${cacheKey}`;
			await redisService.set(thresholdKey, threshold.toString(), 86400); // 24 hours
		} catch (error) {
			logger.error({ error, cacheKey, threshold }, "Failed to set threshold");
		}
	}

	/**
	 * Get all cache keys that need pre-warming
	 * Scans for keys with high access patterns
	 */
	async getHotCacheKeys(): Promise<string[]> {
		try {
			const pattern = `${this.hitKeyPrefix}*`;
			const keys = await redisService.keys(pattern);

			const hotKeys: string[] = [];

			for (const key of keys) {
				// Extract cache key name (remove prefix and :miss suffix)
				const cacheKey = key.replace(this.hitKeyPrefix, "").replace(":miss", "");

				// Skip if already processed
				if (hotKeys.includes(cacheKey)) continue;

				// Check if needs pre-warming
				const needs = await this.needsPrewarming(cacheKey);
				if (needs) {
					hotKeys.push(cacheKey);
				}
			}

			return hotKeys;
		} catch (error) {
			logger.error({ error }, "Failed to get hot cache keys");
			return [];
		}
	}

	/**
	 * Reset tracking stats for a cache key
	 */
	async resetStats(cacheKey: string): Promise<void> {
		try {
			const hitKey = `${this.hitKeyPrefix}${cacheKey}`;
			const missKey = `${this.hitKeyPrefix}${cacheKey}:miss`;

			await redisService.del(hitKey);
			await redisService.del(missKey);

			logger.info({ cacheKey }, "Reset cache tracking stats");
		} catch (error) {
			logger.error({ error, cacheKey }, "Failed to reset cache stats");
		}
	}

	/**
	 * Get dashboard stats for all tracked cache keys
	 */
	async getDashboardStats(): Promise<
		Array<{
			cacheKey: string;
			hits: number;
			misses: number;
			hitRate: number;
			needsPrewarm: boolean;
		}>
	> {
		try {
			const pattern = `${this.hitKeyPrefix}*`;
			const keys = await redisService.keys(pattern);

			const uniqueKeys = new Set<string>();
			for (const key of keys) {
				const cacheKey = key.replace(this.hitKeyPrefix, "").replace(":miss", "");
				uniqueKeys.add(cacheKey);
			}

			const stats = await Promise.all(
				Array.from(uniqueKeys).map(async (cacheKey) => {
					const cacheStats = await this.getCacheStats(cacheKey);
					const needsPrewarm = await this.needsPrewarming(cacheKey);

					return {
						cacheKey,
						...cacheStats,
						needsPrewarm,
					};
				})
			);

			// Sort by total access (hits + misses) descending
			return stats.sort((a, b) => b.hits + b.misses - (a.hits + a.misses));
		} catch (error) {
			logger.error({ error }, "Failed to get dashboard stats");
			return [];
		}
	}
}

export const cacheHitTracker = new CacheHitTrackerService();

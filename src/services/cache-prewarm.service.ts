import { logger } from "@/server";
import { clientService } from "@/api/client/clientService";
import { cacheHitTracker } from "./cache-hit-tracker.service";
import * as cron from "node-cron";

/**
 * Cache pre-warming service
 * Populates high-traffic cache keys on application startup and via scheduled cron jobs
 * Intelligently detects hot cache keys using Redis INCRBY tracking
 */
export class CachePrewarmService {
	private cronJob: cron.ScheduledTask | null = null;
	/**
	 * Pre-warm all critical cache endpoints
	 * Should be called after database and Redis connections are established
	 */
	async prewarmAll(): Promise<void> {
		logger.info("Starting cache pre-warming...");

		try {
			await Promise.allSettled([this.prewarmDailyUsage(), this.prewarmTopClients()]);

			logger.info("Cache pre-warming completed successfully");
		} catch (error) {
			// Don't fail startup if pre-warming fails
			logger.warn({ error }, "Cache pre-warming failed, continuing with cold cache");
		}
	}

	/**
	 * Start cron job for periodic cache pre-warming
	 * Runs every 10 minutes to refresh hot cache keys
	 */
	startCronJob(): void {
		if (this.cronJob) {
			logger.warn("Cache pre-warming cron job already running");
			return;
		}

		// Schedule: Every 10 minutes
		this.cronJob = cron.schedule("*/10 * * * *", async () => {
			logger.info("🔄 Running scheduled cache pre-warming...");
			try {
				await this.prewarmHotKeys();
				logger.info("✅ Scheduled cache pre-warming completed");
			} catch (error) {
				logger.error({ error }, "❌ Scheduled cache pre-warming failed");
			}
		});

		logger.info("✅ Cache pre-warming cron job started (every 10 minutes)");
	}

	/**
	 * Stop cron job
	 */
	stopCronJob(): void {
		if (this.cronJob) {
			this.cronJob.stop();
			this.cronJob = null;
			logger.info("Cache pre-warming cron job stopped");
		}
	}

	/**
	 * Intelligently pre-warm cache keys based on access patterns
	 * Uses Redis INCRBY tracking to detect hot keys
	 */
	private async prewarmHotKeys(): Promise<void> {
		try {
			// Get hot cache keys that need pre-warming
			const hotKeys = await cacheHitTracker.getHotCacheKeys();

			if (hotKeys.length === 0) {
				logger.info("No hot cache keys detected, running standard pre-warm");
				await this.prewarmAll();
				return;
			}

			logger.info({ hotKeys, count: hotKeys.length }, "Pre-warming hot cache keys");

			// Pre-warm detected hot keys
			for (const cacheKey of hotKeys) {
				await this.prewarmByCacheKey(cacheKey);
			}

			// Also run standard pre-warm for common queries
			await this.prewarmAll();
		} catch (error) {
			logger.error({ error }, "Failed to pre-warm hot keys");
		}
	}

	/**
	 * Pre-warm cache based on cache key pattern
	 */
	private async prewarmByCacheKey(cacheKey: string): Promise<void> {
		try {
			// Parse cache key to determine which service method to call
			if (cacheKey.startsWith("usage:daily:")) {
				const days = Number.parseInt(cacheKey.replace("usage:daily:", ""), 10);
				if (!Number.isNaN(days)) {
					await clientService.prewarmDailyUsage(days);
				}
			} else if (cacheKey.startsWith("usage:top:")) {
				const parts = cacheKey.replace("usage:top:", "").split(":");
				if (parts.length === 2) {
					const hours = Number.parseInt(parts[0], 10);
					const limit = Number.parseInt(parts[1], 10);
					if (!Number.isNaN(hours) && !Number.isNaN(limit)) {
						await clientService.prewarmTopClients(hours, limit);
					}
				}
			}

			logger.info({ cacheKey }, "Pre-warmed cache key");
		} catch (error) {
			logger.warn({ error, cacheKey }, "Failed to pre-warm cache key");
		}
	}

	/**
	 * Pre-warm daily usage cache for common time ranges
	 * Uses dedicated prewarm methods that fetch directly from database
	 */
	private async prewarmDailyUsage(): Promise<void> {
		const commonDays = [7, 30]; // Most common queries

		for (const days of commonDays) {
			try {
				await clientService.prewarmDailyUsage(days);
			} catch (error) {
				logger.warn({ error, days }, "Failed to pre-warm daily usage cache");
			}
		}
	}

	/**
	 * Pre-warm top clients cache for common time ranges
	 * Uses dedicated prewarm methods that fetch directly from database
	 */
	private async prewarmTopClients(): Promise<void> {
		const commonQueries = [
			{ hours: 24, limit: 3 },
			{ hours: 24, limit: 10 },
			{ hours: 168, limit: 10 },
		];

		for (const { hours, limit } of commonQueries) {
			try {
				await clientService.prewarmTopClients(hours, limit);
			} catch (error) {
				logger.warn({ error, hours, limit }, "Failed to pre-warm top clients cache");
			}
		}
	}
}

export const cachePrewarmService = new CachePrewarmService();

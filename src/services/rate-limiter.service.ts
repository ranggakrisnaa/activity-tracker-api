import { redisService } from "./redis.service";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/server";

/**
 * Redis-based rate limiter using sliding window algorithm
 */
export class RateLimiterService {
	private readonly windowSize: number; // in seconds
	private readonly maxRequests: number;

	constructor(maxRequests: number = env.API_RATE_LIMIT, windowSizeSeconds: number = 3600) {
		this.maxRequests = maxRequests;
		this.windowSize = windowSizeSeconds;
	}

	/**
	 * Check if client has exceeded rate limit using sliding window
	 * Returns: { allowed: boolean, remaining: number, resetAt: Date }
	 */
	async checkRateLimit(
		clientId: string
	): Promise<{ allowed: boolean; remaining: number; resetAt: Date; current: number }> {
		const key = `rate_limit:${clientId}`;
		const now = Date.now();
		const windowStart = now - this.windowSize * 1000;

		try {
			// Use Redis sorted set with timestamps as scores
			const client = redisService.getWriteClient();

			// Remove old entries outside the window
			await client.zremrangebyscore(key, 0, windowStart);

			// Count requests in current window
			const currentCount = await client.zcard(key);

			if (currentCount >= this.maxRequests) {
				// Rate limit exceeded
				const oldestEntry = await client.zrange(key, 0, 0, "WITHSCORES");
				const oldestTimestamp = oldestEntry.length > 1 ? Number.parseInt(oldestEntry[1], 10) : now;
				const resetAt = new Date(oldestTimestamp + this.windowSize * 1000);

				return {
					allowed: false,
					remaining: 0,
					resetAt,
					current: currentCount,
				};
			}

			// Add current request
			await client.zadd(key, now, `${now}-${Math.random()}`);

			// Set expiration on the key (cleanup)
			await client.expire(key, this.windowSize + 60);

			// Calculate reset time (end of current window)
			const resetAt = new Date(now + this.windowSize * 1000);

			return {
				allowed: true,
				remaining: this.maxRequests - currentCount - 1,
				resetAt,
				current: currentCount + 1,
			};
		} catch (error) {
			logger.error({ error, clientId }, "Rate limit check failed");
			// On error, allow the request (fail open)
			return {
				allowed: true,
				remaining: this.maxRequests,
				resetAt: new Date(now + this.windowSize * 1000),
				current: 0,
			};
		}
	}

	/**
	 * Get current usage for a client
	 */
	async getCurrentUsage(clientId: string): Promise<{ count: number; resetAt: Date }> {
		const key = `rate_limit:${clientId}`;
		const now = Date.now();
		const windowStart = now - this.windowSize * 1000;

		try {
			const client = redisService.getReadClient();

			// Remove old entries
			await redisService.getWriteClient().zremrangebyscore(key, 0, windowStart);

			// Count current requests
			const count = await client.zcard(key);

			// Get oldest entry to calculate reset time
			const oldestEntry = await client.zrange(key, 0, 0, "WITHSCORES");
			const oldestTimestamp = oldestEntry.length > 1 ? Number.parseInt(oldestEntry[1], 10) : now;
			const resetAt = new Date(oldestTimestamp + this.windowSize * 1000);

			return { count, resetAt };
		} catch (error) {
			logger.error({ error, clientId }, "Failed to get current usage");
			return { count: 0, resetAt: new Date(now + this.windowSize * 1000) };
		}
	}

	/**
	 * Reset rate limit for a client (admin function)
	 */
	async resetRateLimit(clientId: string): Promise<void> {
		const key = `rate_limit:${clientId}`;
		try {
			await redisService.del(key);
			logger.info({ clientId }, "Rate limit reset for client");
		} catch (error) {
			logger.error({ error, clientId }, "Failed to reset rate limit");
			throw error;
		}
	}

	/**
	 * Get rate limit configuration
	 */
	getConfig(): { maxRequests: number; windowSize: number } {
		return {
			maxRequests: this.maxRequests,
			windowSize: this.windowSize,
		};
	}
}

// Export singleton instance
export const rateLimiterService = new RateLimiterService();

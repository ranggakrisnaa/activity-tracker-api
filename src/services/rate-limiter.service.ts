import { redisService } from "./redis.service";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/server";

/**
 * In-memory fallback for rate limiting when Redis is unavailable
 */
interface InMemoryRateLimit {
	timestamps: number[];
}

/**
 * Redis-based rate limiter using sliding window algorithm
 */
export class RateLimiterService {
	private readonly windowSize: number; // in seconds
	private readonly maxRequests: number;
	private inMemoryStore: Map<string, InMemoryRateLimit> = new Map();
	private cleanupInterval: NodeJS.Timeout | null = null;

	// Lua script for atomic rate limit check and increment
	private readonly luaScript = `
		local key = KEYS[1]
		local now = tonumber(ARGV[1])
		local window = tonumber(ARGV[2])
		local limit = tonumber(ARGV[3])
		local windowStart = now - (window * 1000)
		
		-- Remove old entries
		redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
		
		-- Count current requests
		local current = redis.call('ZCARD', key)
		
		if current >= limit then
			-- Rate limit exceeded
			local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
			local resetTime = now
			if #oldest > 0 then
				resetTime = tonumber(oldest[2]) + (window * 1000)
			end
			return {0, current, resetTime}  -- Not allowed
		else
			-- Add current request
			redis.call('ZADD', key, now, now .. '-' .. math.random())
			redis.call('EXPIRE', key, window + 60)
			return {1, current + 1, now + (window * 1000)}  -- Allowed
		end
	`;

	constructor(maxRequests: number = env.API_RATE_LIMIT, windowSizeSeconds: number = 3600) {
		this.maxRequests = maxRequests;
		this.windowSize = windowSizeSeconds;

		// Cleanup in-memory store every 5 minutes
		this.cleanupInterval = setInterval(
			() => {
				this.cleanupInMemoryStore();
			},
			5 * 60 * 1000
		);
	}

	/**
	 * Cleanup old entries from in-memory store
	 */
	private cleanupInMemoryStore(): void {
		const now = Date.now();
		const windowStart = now - this.windowSize * 1000;

		for (const [clientId, data] of this.inMemoryStore.entries()) {
			data.timestamps = data.timestamps.filter((ts) => ts > windowStart);
			if (data.timestamps.length === 0) {
				this.inMemoryStore.delete(clientId);
			}
		}
	}

	/**
	 * Check if client has exceeded rate limit using sliding window
	 * Returns: { allowed: boolean, remaining: number, resetAt: Date }
	 * @param clientId - The client identifier
	 * @param maxRequests - Optional per-client rate limit (overrides default)
	 */
	async checkRateLimit(
		clientId: string,
		maxRequests?: number
	): Promise<{ allowed: boolean; remaining: number; resetAt: Date; current: number }> {
		const key = `rate_limit:${clientId}`;
		const now = Date.now();
		const limit = maxRequests || this.maxRequests;

		try {
			// Use Lua script for atomic operations (prevents race conditions)
			const client = redisService.getWriteClient();

			// Execute Lua script atomically
			const result = (await client.eval(
				this.luaScript,
				1, // number of keys
				key, // KEYS[1]
				now.toString(), // ARGV[1]
				this.windowSize.toString(), // ARGV[2]
				limit.toString() // ARGV[3] - Use per-client limit
			)) as [number, number, number];

			const [allowed, current, resetTime] = result;
			const resetAt = new Date(resetTime);

			if (allowed === 0) {
				// Rate limit exceeded
				logger.warn({ clientId, current, limit }, "Rate limit exceeded");
				return {
					allowed: false,
					remaining: 0,
					resetAt,
					current,
				};
			}

			// Request allowed
			return {
				allowed: true,
				remaining: limit - current,
				resetAt,
				current,
			};
		} catch (error) {
			logger.error({ error, clientId }, "Rate limit check failed, using in-memory fallback");
			// Fallback to in-memory rate limiting
			return this.checkRateLimitInMemory(clientId);
		}
	}

	/**
	 * In-memory rate limiting fallback (when Redis is unavailable)
	 */
	private checkRateLimitInMemory(clientId: string): {
		allowed: boolean;
		remaining: number;
		resetAt: Date;
		current: number;
	} {
		const now = Date.now();
		const windowStart = now - this.windowSize * 1000;

		// Get or create client data
		let clientData = this.inMemoryStore.get(clientId);
		if (!clientData) {
			clientData = { timestamps: [] };
			this.inMemoryStore.set(clientId, clientData);
		}

		// Remove old timestamps outside the window
		clientData.timestamps = clientData.timestamps.filter((ts) => ts > windowStart);

		const currentCount = clientData.timestamps.length;

		if (currentCount >= this.maxRequests) {
			// Rate limit exceeded
			const oldestTimestamp = clientData.timestamps[0] || now;
			const resetAt = new Date(oldestTimestamp + this.windowSize * 1000);

			logger.warn({ clientId, currentCount, maxRequests: this.maxRequests }, "Rate limit exceeded (in-memory)");

			return {
				allowed: false,
				remaining: 0,
				resetAt,
				current: currentCount,
			};
		}

		// Add current request
		clientData.timestamps.push(now);

		// Calculate reset time
		const resetAt = new Date(now + this.windowSize * 1000);

		logger.debug(
			{ clientId, currentCount: currentCount + 1, maxRequests: this.maxRequests },
			"Rate limit OK (in-memory)"
		);

		return {
			allowed: true,
			remaining: this.maxRequests - currentCount - 1,
			resetAt,
			current: currentCount + 1,
		};
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
			// Also clear in-memory fallback
			this.inMemoryStore.delete(clientId);
			logger.info({ clientId }, "Rate limit reset for client");
		} catch (error) {
			logger.error({ error, clientId }, "Failed to reset rate limit in Redis");
			// Still clear in-memory
			this.inMemoryStore.delete(clientId);
		}
	}

	/**
	 * Check rate limit for specific endpoint (optional granularity)
	 * Useful for different limits per endpoint (e.g., writes vs reads)
	 */
	async checkRateLimitForEndpoint(
		clientId: string,
		endpoint: string,
		maxRequests?: number
	): Promise<{ allowed: boolean; remaining: number; resetAt: Date; current: number }> {
		const key = `rate_limit:${clientId}:${endpoint}`;
		const limit = maxRequests || this.maxRequests;
		const now = Date.now();

		try {
			const client = redisService.getWriteClient();

			const result = (await client.eval(
				this.luaScript,
				1,
				key,
				now.toString(),
				this.windowSize.toString(),
				limit.toString()
			)) as [number, number, number];

			const [allowed, current, resetTime] = result;
			const resetAt = new Date(resetTime);

			if (allowed === 0) {
				logger.warn({ clientId, endpoint, current, limit }, "Endpoint rate limit exceeded");
				return { allowed: false, remaining: 0, resetAt, current };
			}

			return { allowed: true, remaining: limit - current, resetAt, current };
		} catch (error) {
			logger.error({ error, clientId, endpoint }, "Endpoint rate limit check failed");
			return this.checkRateLimitInMemory(clientId);
		}
	}

	/**
	 * Get statistics for monitoring
	 */
	async getStatistics(clientId: string): Promise<{
		current: number;
		limit: number;
		remaining: number;
		percentUsed: number;
		resetAt: Date;
	}> {
		const usage = await this.getCurrentUsage(clientId);
		const remaining = Math.max(0, this.maxRequests - usage.count);
		const percentUsed = (usage.count / this.maxRequests) * 100;

		return {
			current: usage.count,
			limit: this.maxRequests,
			remaining,
			percentUsed: Math.round(percentUsed * 100) / 100,
			resetAt: usage.resetAt,
		};
	}

	/**
	 * Stop cleanup interval
	 */
	stop(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
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

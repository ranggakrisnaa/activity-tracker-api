import Redis from "ioredis";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/server";

interface RedisConfig {
	primary: {
		host: string;
		port: number;
		password?: string;
	};
	replica?: {
		host: string;
		port: number;
		password?: string;
	};
	sentinel?: {
		hosts: Array<{ host: string; port: number }>;
		masterName: string;
		password?: string;
	};
}

class RedisService {
	private writeClient: Redis | null = null;
	private readClient: Redis | null = null;
	private isConnected = false;
	private reconnectAttempts = 0;
	private readonly maxReconnectAttempts = 5;

	/**
	 * Initialize Redis connection with Sentinel support and read/write splitting
	 */
	async connect(): Promise<void> {
		try {
			const config = this.buildConfig();

			// Use Sentinel if configured
			if (config.sentinel && config.sentinel.hosts.length > 0) {
				logger.info("🔄 Connecting to Redis via Sentinel...");
				await this.connectViaSentinel(config.sentinel);
			} else {
				logger.info("🔄 Connecting to Redis directly...");
				await this.connectDirectly(config);
			}

			this.isConnected = true;
			this.reconnectAttempts = 0;
			logger.info("✅ Redis connected successfully");
		} catch (error) {
			logger.error({ error }, "❌ Failed to connect to Redis");
			throw error;
		}
	}

	/**
	 * Connect to Redis via Sentinel for high availability
	 */
	private async connectViaSentinel(sentinelConfig: RedisConfig["sentinel"]): Promise<void> {
		if (!sentinelConfig) throw new Error("Sentinel configuration is required");

		const options = {
			sentinels: sentinelConfig.hosts,
			name: sentinelConfig.masterName,
			password: sentinelConfig.password,
			retryStrategy: (times: number) => this.retryStrategy(times),
			reconnectOnError: (err: Error) => {
				logger.error({ err }, "Redis reconnect on error");
				return true;
			},
			maxRetriesPerRequest: 3,
			enableReadyCheck: true,
			lazyConnect: false,
		};

		// Write client connects to master via Sentinel
		this.writeClient = new Redis({
			...options,
			role: "master",
		});

		// Read client connects to slave via Sentinel for load balancing
		this.readClient = new Redis({
			...options,
			role: "slave",
		});

		this.setupEventHandlers(this.writeClient, "write");
		this.setupEventHandlers(this.readClient, "read");

		// Wait for both connections
		await Promise.all([
			this.waitForConnection(this.writeClient, "write"),
			this.waitForConnection(this.readClient, "read"),
		]);
	}

	/**
	 * Connect to Redis directly without Sentinel
	 */
	private async connectDirectly(config: RedisConfig): Promise<void> {
		const commonOptions = {
			retryStrategy: (times: number) => this.retryStrategy(times),
			maxRetriesPerRequest: 3,
			enableReadyCheck: true,
			lazyConnect: false,
		};

		// Write client connects to primary
		this.writeClient = new Redis({
			host: config.primary.host,
			port: config.primary.port,
			password: config.primary.password,
			...commonOptions,
		});

		// Read client connects to replica if available, otherwise use primary
		if (config.replica) {
			this.readClient = new Redis({
				host: config.replica.host,
				port: config.replica.port,
				password: config.replica.password,
				...commonOptions,
			});
		} else {
			// Fallback to primary for reads if no replica configured
			this.readClient = this.writeClient;
		}

		this.setupEventHandlers(this.writeClient, "write");
		if (this.readClient !== this.writeClient) {
			this.setupEventHandlers(this.readClient, "read");
		}

		// Wait for connections
		if (this.readClient === this.writeClient) {
			await this.waitForConnection(this.writeClient, "write");
		} else {
			await Promise.all([
				this.waitForConnection(this.writeClient, "write"),
				this.waitForConnection(this.readClient, "read"),
			]);
		}
	}

	/**
	 * Build Redis configuration from environment variables
	 */
	private buildConfig(): RedisConfig {
		const config: RedisConfig = {
			primary: {
				host: env.REDIS_HOST,
				port: env.REDIS_PORT,
				password: env.REDIS_PASSWORD || undefined,
			},
		};

		// Add replica if configured
		if (env.REDIS_READ_HOST && env.REDIS_READ_PORT) {
			config.replica = {
				host: env.REDIS_READ_HOST,
				port: env.REDIS_READ_PORT,
				password: env.REDIS_PASSWORD || undefined,
			};
		}

		// Add Sentinel if configured
		if (env.REDIS_SENTINEL_HOSTS && env.REDIS_SENTINEL_MASTER_NAME) {
			const sentinelHosts = env.REDIS_SENTINEL_HOSTS.split(",").map((host) => {
				const [hostname, port] = host.split(":");
				return { host: hostname, port: Number.parseInt(port, 10) };
			});

			config.sentinel = {
				hosts: sentinelHosts,
				masterName: env.REDIS_SENTINEL_MASTER_NAME,
				password: env.REDIS_PASSWORD || undefined,
			};
		}

		return config;
	}

	/**
	 * Setup event handlers for Redis connection
	 */
	private setupEventHandlers(client: Redis, type: "write" | "read"): void {
		client.on("connect", () => {
			logger.info(`✅ Redis ${type} client connected`);
		});

		client.on("ready", () => {
			logger.info(`✅ Redis ${type} client ready`);
		});

		client.on("error", (err) => {
			logger.error({ err }, `❌ Redis ${type} client error`);
		});

		client.on("close", () => {
			logger.warn(`⚠️  Redis ${type} client connection closed`);
			this.isConnected = false;
		});

		client.on("reconnecting", (delay: number) => {
			logger.info(`🔄 Redis ${type} client reconnecting in ${delay}ms...`);
		});
	}

	/**
	 * Wait for Redis connection to be ready
	 */
	private async waitForConnection(client: Redis, type: "write" | "read"): Promise<void> {
		return new Promise((resolve, reject) => {
			if (client.status === "ready") {
				resolve();
				return;
			}

			const timeout = setTimeout(() => {
				reject(new Error(`Redis ${type} client connection timeout`));
			}, 10000);

			client.once("ready", () => {
				clearTimeout(timeout);
				resolve();
			});

			client.once("error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});
		});
	}

	/**
	 * Retry strategy for reconnection
	 */
	private retryStrategy(times: number): number | null {
		this.reconnectAttempts = times;

		if (times > this.maxReconnectAttempts) {
			logger.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
			return null;
		}

		// Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
		const delay = Math.min(100 * Math.pow(2, times - 1), 3000);
		logger.info(`🔄 Retry attempt ${times}/${this.maxReconnectAttempts} in ${delay}ms`);
		return delay;
	}

	/**
	 * Get value from Redis (uses read replica)
	 */
	async get(key: string): Promise<string | null> {
		this.ensureConnected();
		try {
			return await this.readClient!.get(key);
		} catch (error) {
			logger.error({ error, key }, `Failed to GET key "${key}"`);
			throw error;
		}
	}

	/**
	 * Get value from Redis and parse as JSON
	 */
	async getJSON<T>(key: string): Promise<T | null> {
		const value = await this.get(key);
		if (!value) return null;

		try {
			return JSON.parse(value) as T;
		} catch (error) {
			logger.error({ error, key }, `Failed to parse JSON for key "${key}"`);
			throw error;
		}
	}

	/**
	 * Set value in Redis (uses write primary)
	 */
	async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
		this.ensureConnected();
		try {
			if (ttlSeconds) {
				await this.writeClient!.setex(key, ttlSeconds, value);
			} else {
				await this.writeClient!.set(key, value);
			}
		} catch (error) {
			logger.error({ error, key }, `Failed to SET key "${key}"`);
			throw error;
		}
	}

	/**
	 * Set value in Redis with JSON serialization
	 */
	async setJSON<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
		const serialized = JSON.stringify(value);
		await this.set(key, serialized, ttlSeconds);
	}

	/**
	 * Delete key from Redis (uses write primary)
	 */
	async del(key: string): Promise<void> {
		this.ensureConnected();
		try {
			await this.writeClient!.del(key);
		} catch (error) {
			logger.error({ error, key }, `Failed to DELETE key "${key}"`);
			throw error;
		}
	}

	/**
	 * Delete multiple keys from Redis using pipeline (uses write primary)
	 */
	async delMany(keys: string[]): Promise<void> {
		if (keys.length === 0) return;

		this.ensureConnected();
		try {
			// Use pipeline for better performance with multiple keys
			const pipeline = this.writeClient!.pipeline();
			for (const key of keys) {
				pipeline.del(key);
			}
			await pipeline.exec();
			logger.debug({ keyCount: keys.length }, "Deleted multiple keys via pipeline");
		} catch (error) {
			logger.error({ error, keys }, `Failed to DELETE keys`);
			throw error;
		}
	}

	/**
	 * Check if key exists in Redis (uses read replica)
	 */
	async exists(key: string): Promise<boolean> {
		this.ensureConnected();
		try {
			const result = await this.readClient!.exists(key);
			return result === 1;
		} catch (error) {
			logger.error({ error, key }, `Failed to check EXISTS for key "${key}"`);
			throw error;
		}
	}

	/**
	 * Set expiration on key (uses write primary)
	 */
	async expire(key: string, ttlSeconds: number): Promise<void> {
		this.ensureConnected();
		try {
			await this.writeClient!.expire(key, ttlSeconds);
		} catch (error) {
			logger.error({ error, key }, `Failed to EXPIRE key "${key}"`);
			throw error;
		}
	}

	/**
	 * Get time to live for key (uses read replica)
	 */
	async ttl(key: string): Promise<number> {
		this.ensureConnected();
		try {
			return await this.readClient!.ttl(key);
		} catch (error) {
			logger.error({ error, key }, `Failed to get TTL for key "${key}"`);
			throw error;
		}
	}

	/**
	 * Increment value in Redis (uses write primary)
	 */
	async incr(key: string): Promise<number> {
		this.ensureConnected();
		try {
			return await this.writeClient!.incr(key);
		} catch (error) {
			logger.error({ error, key }, `Failed to INCR key "${key}"`);
			throw error;
		}
	}

	/**
	 * Increment value by amount in Redis (uses write primary)
	 */
	async incrBy(key: string, amount: number): Promise<number> {
		this.ensureConnected();
		try {
			return await this.writeClient!.incrby(key, amount);
		} catch (error) {
			logger.error({ error, key, amount }, `Failed to INCRBY key "${key}"`);
			throw error;
		}
	}

	/**
	 * Decrement value in Redis (uses write primary)
	 */
	async decr(key: string): Promise<number> {
		this.ensureConnected();
		try {
			return await this.writeClient!.decr(key);
		} catch (error) {
			logger.error({ error, key }, `Failed to DECR key "${key}"`);
			throw error;
		}
	}

	/**
	 * Get multiple keys from Redis (uses read replica)
	 */
	async mget(keys: string[]): Promise<Array<string | null>> {
		if (keys.length === 0) return [];

		this.ensureConnected();
		try {
			return await this.readClient!.mget(...keys);
		} catch (error) {
			logger.error({ error, keys }, `Failed to MGET keys`);
			throw error;
		}
	}

	/**
	 * Set multiple key-value pairs in Redis (uses write primary)
	 */
	async mset(keyValues: Record<string, string>): Promise<void> {
		const entries = Object.entries(keyValues);
		if (entries.length === 0) return;

		this.ensureConnected();
		try {
			const flatArray = entries.flat();
			await this.writeClient!.mset(...flatArray);
		} catch (error) {
			logger.error({ error, keyValues }, `Failed to MSET keys`);
			throw error;
		}
	}

	/**
	 * Get all keys matching pattern (uses read replica)
	 */
	async keys(pattern: string): Promise<string[]> {
		this.ensureConnected();
		try {
			return await this.readClient!.keys(pattern);
		} catch (error) {
			logger.error({ error, pattern }, `Failed to get KEYS for pattern "${pattern}"`);
			throw error;
		}
	}

	/**
	 * Flush all keys from Redis (DANGEROUS - uses write primary)
	 */
	async flushAll(): Promise<void> {
		this.ensureConnected();
		try {
			await this.writeClient!.flushall();
			logger.warn("⚠️  Redis FLUSHALL executed - all keys deleted");
		} catch (error) {
			logger.error({ error }, "Failed to FLUSHALL");
			throw error;
		}
	}

	/**
	 * Get Redis info (uses read replica)
	 */
	async info(section?: string): Promise<string> {
		this.ensureConnected();
		try {
			return section ? await this.readClient!.info(section) : await this.readClient!.info();
		} catch (error) {
			logger.error({ error }, "Failed to get INFO");
			throw error;
		}
	}

	/**
	 * Ping Redis server (uses read replica)
	 */
	async ping(): Promise<string> {
		this.ensureConnected();
		try {
			return await this.readClient!.ping();
		} catch (error) {
			logger.error({ error }, "Failed to PING");
			throw error;
		}
	}

	/**
	 * Check if Redis is connected
	 */
	get connected(): boolean {
		return this.isConnected;
	}

	/**
	 * Get write client for advanced operations
	 */
	getWriteClient(): Redis {
		this.ensureConnected();
		return this.writeClient!;
	}

	/**
	 * Get read client for advanced operations
	 */
	getReadClient(): Redis {
		this.ensureConnected();
		return this.readClient!;
	}

	/**
	 * Ensure Redis is connected
	 */
	private ensureConnected(): void {
		if (!this.isConnected || !this.writeClient || !this.readClient) {
			throw new Error("Redis is not connected. Call connect() first.");
		}
	}

	/**
	 * Subscribe to a Redis Pub/Sub channel
	 */
	async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
		this.ensureConnected();

		const subscriber = this.readClient!.duplicate();
		await subscriber.subscribe(channel);

		subscriber.on("message", (ch, message) => {
			if (ch === channel) {
				callback(message);
			}
		});

		logger.info({ channel }, "Subscribed to Redis channel");
	}

	/**
	 * Publish message to Redis Pub/Sub channel
	 */
	async publish(channel: string, message: string): Promise<number> {
		this.ensureConnected();
		const result = await this.writeClient!.publish(channel, message);
		logger.debug({ channel, message }, "Published to Redis channel");
		return result;
	}

	/**
	 * Execute multiple commands using Redis pipeline for better performance
	 */
	async pipeline(commands: Array<{ command: string; args: unknown[] }>): Promise<unknown[]> {
		this.ensureConnected();
		const pipeline = this.writeClient!.pipeline();

		for (const { command, args } of commands) {
			// @ts-expect-error - Dynamic command execution
			pipeline[command](...args);
		}

		const results = await pipeline.exec();
		if (!results) {
			throw new Error("Pipeline execution failed");
		}

		// Extract results and check for errors
		const parsedResults = results.map(([error, result]) => {
			if (error) {
				throw error;
			}
			return result;
		});

		logger.debug({ commandCount: commands.length }, "Pipeline executed successfully");
		return parsedResults;
	}

	/**
	 * Set multiple JSON values using pipeline
	 */
	async setJSONMany(entries: Array<{ key: string; value: unknown; ttl?: number }>): Promise<void> {
		if (entries.length === 0) return;

		this.ensureConnected();
		const pipeline = this.writeClient!.pipeline();

		for (const { key, value, ttl } of entries) {
			const serialized = JSON.stringify(value);
			if (ttl && ttl > 0) {
				pipeline.setex(key, ttl, serialized);
			} else {
				pipeline.set(key, serialized);
			}
		}

		await pipeline.exec();
		logger.debug({ entryCount: entries.length }, "Set multiple JSON values via pipeline");
	}

	/**
	 * Get multiple JSON values using pipeline
	 */
	async getJSONMany<T = unknown>(keys: string[]): Promise<Array<T | null>> {
		if (keys.length === 0) return [];

		this.ensureConnected();
		const pipeline = this.readClient!.pipeline();

		for (const key of keys) {
			pipeline.get(key);
		}

		const results = await pipeline.exec();
		if (!results) {
			throw new Error("Pipeline execution failed");
		}

		return results.map(([error, result]) => {
			if (error) {
				logger.error({ error }, "Error getting value from pipeline");
				return null;
			}
			if (!result) return null;

			try {
				return JSON.parse(result as string) as T;
			} catch (parseError) {
				logger.error({ parseError, result }, "Failed to parse JSON from cache");
				return null;
			}
		});
	}

	/**
	 * Invalidate cache with pattern matching using pipeline
	 */
	async invalidatePattern(pattern: string): Promise<number> {
		this.ensureConnected();
		const keys = await this.writeClient!.keys(pattern);

		if (keys.length === 0) {
			return 0;
		}

		const pipeline = this.writeClient!.pipeline();
		for (const key of keys) {
			pipeline.del(key);
		}

		await pipeline.exec();
		logger.info({ pattern, keyCount: keys.length }, "Invalidated cache pattern via pipeline");
		return keys.length;
	}

	/**
	 * Disconnect from Redis
	 */
	async disconnect(): Promise<void> {
		try {
			if (this.writeClient) {
				await this.writeClient.quit();
				this.writeClient = null;
			}

			if (this.readClient && this.readClient !== this.writeClient) {
				await this.readClient.quit();
				this.readClient = null;
			}

			this.isConnected = false;
			logger.info("✅ Redis disconnected successfully");
		} catch (error) {
			logger.error({ error }, "❌ Failed to disconnect from Redis");
			throw error;
		}
	}
}

// Export singleton instance
export const redisService = new RedisService();

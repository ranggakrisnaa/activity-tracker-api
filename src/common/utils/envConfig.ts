import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
	NODE_ENV: z.enum(["development", "production", "test"]).default("production"),

	HOST: z.string().min(1).default("localhost"),

	PORT: z.coerce.number().int().positive().default(8080),

	CORS_ORIGIN: z.string().url().default("http://localhost:8080"),

	COMMON_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(1000),

	COMMON_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(1000),

	// Database Configuration
	DATABASE_HOST: z.string().default("localhost"),
	DATABASE_PORT: z.coerce.number().int().positive().default(5432),
	DATABASE_USER: z.string().default("postgres"),
	DATABASE_PASSWORD: z.string().default("postgres123"),
	DATABASE_NAME: z.string().default("activity_tracker"),
	DATABASE_READ_REPLICAS: z.string().optional(),

	// Redis Configuration
	REDIS_HOST: z.string().default("localhost"),
	REDIS_PORT: z.coerce.number().int().positive().default(6379),
	REDIS_PASSWORD: z.string().optional(),
	REDIS_READ_HOST: z.string().optional(),
	REDIS_READ_PORT: z.coerce.number().int().positive().optional(),
	REDIS_SENTINEL_HOSTS: z.string().optional(),
	REDIS_SENTINEL_MASTER_NAME: z.string().default("mymaster"),

	// JWT Configuration
	JWT_SECRET: z.string().min(32).default("your-super-secret-jwt-key-change-this-in-production"),
	JWT_EXPIRES_IN: z.string().default("24h"),

	// Rate Limiting
	API_RATE_LIMIT: z.coerce.number().int().positive().default(1000),

	// Cache TTL (in seconds)
	CACHE_TTL_USAGE_DAILY: z.coerce.number().int().positive().default(3600),
	CACHE_TTL_USAGE_TOP: z.coerce.number().int().positive().default(3600),

	// Logging
	LOG_BATCH_SIZE: z.coerce.number().int().positive().default(100),
	LOG_BATCH_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
	console.error("❌ Invalid environment variables:", parsedEnv.error.format());
	throw new Error("Invalid environment variables");
}

export const env = {
	...parsedEnv.data,
	isDevelopment: parsedEnv.data.NODE_ENV === "development",
	isProduction: parsedEnv.data.NODE_ENV === "production",
	isTest: parsedEnv.data.NODE_ENV === "test",
};

export const envConfig = env;

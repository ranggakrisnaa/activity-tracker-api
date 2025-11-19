import { env } from "@/common/utils/envConfig";
import { app, logger } from "@/server";
import { redisService } from "@/services/redis.service";
import { closeDatabase, initializeDatabase } from "./database/data-source";
import { websocketService } from "./services/websocket.service";

async function startServer() {
	try {
		// Initialize database connection
		logger.info("🔄 Initializing database...");
		await initializeDatabase();
		logger.info("✅ Database connected");

		// Initialize Redis connection
		logger.info("🔄 Initializing Redis...");
		await redisService.connect();
		logger.info("✅ Redis connected");

		// Pre-warm cache for high-traffic endpoints
		if (env.CACHE_PREWARM_ENABLED) {
			logger.info("🔄 Pre-warming cache...");
			const { cachePrewarmService } = await import("./services/cache-prewarm.service");
			await cachePrewarmService.prewarmAll();
			logger.info("✅ Cache pre-warmed");

			// Start cron job for periodic cache pre-warming
			if (env.CACHE_PREWARM_CRON_ENABLED) {
				cachePrewarmService.startCronJob();
			}
		} else {
			logger.info("⏭️  Cache pre-warming disabled");
		}

		// Start HTTP server
		const server = app.listen(env.PORT, () => {
			const { NODE_ENV, HOST, PORT } = env;
			logger.info(`Server (${NODE_ENV}) running on port http://${HOST}:${PORT}`);
		});

		// Initialize WebSocket service
		logger.info("🔄 Initializing WebSocket...");
		websocketService.initialize(server);

		// Subscribe to Redis Pub/Sub for real-time updates
		await redisService.subscribe("api:log:new", (message) => {
			try {
				const logEvent = JSON.parse(message);
				websocketService.broadcastNewLog(logEvent);
			} catch (error) {
				logger.error({ error, message }, "Failed to parse Redis message");
			}
		});

		// Graceful shutdown handler
		const onCloseSignal = async () => {
			logger.info("sigint received, shutting down gracefully...");

			// Stop cache pre-warming cron job
			if (env.CACHE_PREWARM_CRON_ENABLED) {
				try {
					const { cachePrewarmService } = await import("./services/cache-prewarm.service");
					cachePrewarmService.stopCronJob();
					logger.info("Cache pre-warming cron job stopped");
				} catch (error) {
					logger.error({ error }, "Error stopping cache pre-warming cron");
				}
			}

			// Close WebSocket connections
			try {
				websocketService.close();
				logger.info("WebSocket connections closed");
			} catch (error) {
				logger.error({ error }, "Error closing WebSocket");
			}

			// Close HTTP server
			server.close(async () => {
				logger.info("HTTP server closed");

				// Close database connections
				try {
					await closeDatabase();
					logger.info("Database connections closed");
				} catch (error) {
					logger.error({ error }, "Error closing database");
				}

				// Close Redis connections
				try {
					await redisService.disconnect();
					logger.info("Redis connections closed");
				} catch (error) {
					logger.error({ error }, "Error closing Redis");
				}

				logger.info("Shutdown complete");
				process.exit(0);
			});

			// Force shutdown after 10s
			setTimeout(() => {
				logger.error("Forced shutdown after timeout");
				process.exit(1);
			}, 10000).unref();
		};

		process.on("SIGINT", onCloseSignal);
		process.on("SIGTERM", onCloseSignal);
	} catch (error) {
		logger.error({ error }, "Failed to start server");
		process.exit(1);
	}
}

// Start the server
startServer();

import { env } from "@/common/utils/envConfig";
import { app, logger } from "@/server";
import { redisService } from "@/services/redis.service";
import { closeDatabase, initializeDatabase } from "./database/data-source";

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

		// Start HTTP server
		const server = app.listen(env.PORT, () => {
			const { NODE_ENV, HOST, PORT } = env;
			logger.info(`Server (${NODE_ENV}) running on port http://${HOST}:${PORT}`);
		});

		// Graceful shutdown handler
		const onCloseSignal = async () => {
			logger.info("sigint received, shutting down gracefully...");

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

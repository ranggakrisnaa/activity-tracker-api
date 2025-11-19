import "reflect-metadata";
import { DataSource, DataSourceOptions } from "typeorm";
import { Client } from "./entities/client.entity";
import { ApiLog } from "./entities/api_log.entity";
import { envConfig } from "@/common/utils/envConfig";

// Primary database configuration (write operations)
const primaryConfig: DataSourceOptions = {
	type: "postgres",
	host: envConfig.DATABASE_HOST || "localhost",
	port: envConfig.DATABASE_PORT || 5432,
	username: envConfig.DATABASE_USER || "postgres",
	password: envConfig.DATABASE_PASSWORD || "postgres123",
	database: envConfig.DATABASE_NAME || "activity_tracker",
	synchronize: envConfig.NODE_ENV === "development",
	logging: envConfig.NODE_ENV === "development",
	entities: [Client, ApiLog],
	migrations: ["src/database/migrations/**/*.ts"],
	subscribers: [],
	maxQueryExecutionTime: 1000,
	poolSize: 20,
};

// Read replica configurations
interface ReplicaConfig {
	host: string;
	port: number;
	username: string;
	password: string;
	database: string;
}

const replicaConfigs: ReplicaConfig[] = [];

// Parse replica connection strings from environment
if (envConfig.DATABASE_READ_REPLICAS) {
	const replicas = envConfig.DATABASE_READ_REPLICAS.split(",");
	replicas.forEach((replica: string) => {
		const [host, portStr] = replica.split(":");
		replicaConfigs.push({
			host: host.trim(),
			port: portStr ? parseInt(portStr) : 5432,
			username: envConfig.DATABASE_USER || "postgres",
			password: envConfig.DATABASE_PASSWORD || "postgres123",
			database: envConfig.DATABASE_NAME || "activity_tracker",
		});
	});
}

// Create DataSource with replication support
export const AppDataSource = new DataSource({
	...primaryConfig,
	replication:
		replicaConfigs.length > 0
			? {
					master: {
						host: primaryConfig.host as string,
						port: primaryConfig.port as number,
						username: primaryConfig.username as string,
						password: primaryConfig.password as string,
						database: primaryConfig.database as string,
					},
					slaves: replicaConfigs,
				}
			: undefined,
}); // Initialize connection
export const initializeDatabase = async (): Promise<void> => {
	try {
		if (!AppDataSource.isInitialized) {
			await AppDataSource.initialize();
			console.log("✅ Database connection established successfully");

			if (replicaConfigs.length > 0) {
				console.log(`✅ Connected to ${replicaConfigs.length} read replica(s)`);
			}
		}
	} catch (error) {
		console.error("❌ Error during Data Source initialization:", error);
		throw error;
	}
};

// Close connection
export const closeDatabase = async (): Promise<void> => {
	if (AppDataSource.isInitialized) {
		await AppDataSource.destroy();
		console.log("Database connection closed");
	}
};

import "reflect-metadata";
import { AppDataSource, initializeDatabase } from "./database/data-source";

async function testDatabaseConnection() {
	try {
		console.log("🔄 Testing database connection...");

		await initializeDatabase();

		console.log("✅ Database connection successful!");
		console.log(`📊 Database: ${AppDataSource.options.database}`);
		console.log(`🏠 Host: ${(AppDataSource.options as any).host}`);
		console.log(`🔌 Port: ${(AppDataSource.options as any).port}`);

		if ((AppDataSource.options as any).replication) {
			const replication = (AppDataSource.options as any).replication;
			console.log(`🔄 Replication enabled:`);
			console.log(`   Primary: ${replication.master.host}:${replication.master.port}`);
			console.log(`   Replicas: ${replication.slaves.length}`);
			replication.slaves.forEach((slave: any, index: number) => {
				console.log(`   - Replica ${index + 1}: ${slave.host}:${slave.port}`);
			});
		}

		await AppDataSource.destroy();
		console.log("\n✅ Test completed successfully!");
		process.exit(0);
	} catch (error) {
		console.error("❌ Database connection failed:", error);
		process.exit(1);
	}
}

testDatabaseConnection();

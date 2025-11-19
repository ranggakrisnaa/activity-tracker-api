import { Repository, Between } from "typeorm";
import { AppDataSource } from "@/database/data-source";
import { ApiLog } from "@/database/entities/api_log.entity";
import { logger } from "@/server";

export interface CreateApiLogData {
	clientId: string;
	apiKey: string;
	endpoint: string;
	method: string;
	statusCode: number;
	responseTime: number;
	ipAddress: string;
	userAgent?: string;
	requestHeaders?: Record<string, unknown>;
	requestBody?: Record<string, unknown>;
	responseBody?: Record<string, unknown>;
	errorMessage?: string;
	metadata?: Record<string, unknown>;
}

export interface DailyUsageResult {
	date: string;
	requestCount: number;
	avgResponseTime: number;
	errorCount: number;
}

export interface TopClientResult {
	clientId: string;
	requestCount: number;
	avgResponseTime: number;
	errorCount: number;
	lastAccess: Date;
}

export class ApiLogRepository {
	private repository: Repository<ApiLog>;
	private batchQueue: CreateApiLogData[] = [];
	private batchSize: number;
	private batchInterval: number;
	private batchTimer: NodeJS.Timeout | null = null;

	constructor(batchSize = 100, batchIntervalMs = 5000) {
		this.repository = AppDataSource.getRepository(ApiLog);
		this.batchSize = batchSize;
		this.batchInterval = batchIntervalMs;
		this.startBatchProcessor();
	}

	private startBatchProcessor(): void {
		this.batchTimer = setInterval(() => {
			if (this.batchQueue.length > 0) {
				this.flushBatch().catch((error) => {
					logger.error({ error }, "Failed to flush API log batch");
				});
			}
		}, this.batchInterval);
	}

	async stopBatchProcessor(): Promise<void> {
		if (this.batchTimer) {
			clearInterval(this.batchTimer);
			this.batchTimer = null;
		}
		// Flush remaining logs
		if (this.batchQueue.length > 0) {
			await this.flushBatch();
		}
	}

	async addToBatch(data: CreateApiLogData): Promise<void> {
		this.batchQueue.push(data);

		// Flush immediately if batch size reached
		if (this.batchQueue.length >= this.batchSize) {
			await this.flushBatch();
		}
	}

	private async flushBatch(): Promise<void> {
		if (this.batchQueue.length === 0) return;

		const logsToInsert = [...this.batchQueue];
		this.batchQueue = [];

		try {
			const entities = logsToInsert.map((log) =>
				this.repository.create({
					clientId: log.clientId,
					apiKey: log.apiKey,
					endpoint: log.endpoint,
					method: log.method,
					statusCode: log.statusCode,
					responseTime: log.responseTime,
					ipAddress: log.ipAddress,
					userAgent: log.userAgent,
					requestHeaders: log.requestHeaders,
					requestBody: log.requestBody,
					responseBody: log.responseBody,
					errorMessage: log.errorMessage,
					metadata: log.metadata,
					timestamp: new Date(),
				})
			);

			await this.repository.save(entities);
			logger.info(`✅ Flushed ${entities.length} API logs to database`);
		} catch (error) {
			logger.error({ error, count: logsToInsert.length }, "Failed to flush API logs batch");
			// Re-queue failed logs (with limit to prevent memory issues)
			if (this.batchQueue.length < 1000) {
				this.batchQueue.unshift(...logsToInsert);
			}
		}
	}

	async create(data: CreateApiLogData): Promise<ApiLog> {
		const log = this.repository.create({
			clientId: data.clientId,
			apiKey: data.apiKey,
			endpoint: data.endpoint,
			method: data.method,
			statusCode: data.statusCode,
			responseTime: data.responseTime,
			ipAddress: data.ipAddress,
			userAgent: data.userAgent,
			requestHeaders: data.requestHeaders,
			requestBody: data.requestBody,
			responseBody: data.responseBody,
			errorMessage: data.errorMessage,
			metadata: data.metadata,
			timestamp: new Date(),
		});

		return await this.repository.save(log);
	}

	async findByClientId(clientId: string, limit = 100, offset = 0): Promise<ApiLog[]> {
		return await this.repository.find({
			where: { clientId },
			order: { timestamp: "DESC" },
			take: limit,
			skip: offset,
		});
	}

	async findByDateRange(startDate: Date, endDate: Date, limit = 1000): Promise<ApiLog[]> {
		return await this.repository.find({
			where: {
				timestamp: Between(startDate, endDate),
			},
			order: { timestamp: "DESC" },
			take: limit,
		});
	}

	async getDailyUsage(clientId: string, days = 30): Promise<DailyUsageResult[]> {
		const startDate = new Date();
		startDate.setDate(startDate.getDate() - days);

		const query = this.repository
			.createQueryBuilder("log")
			.select("DATE(log.timestamp)", "date")
			.addSelect("COUNT(*)", "request_count")
			.addSelect("AVG(log.response_time)", "avg_response_time")
			.addSelect("SUM(CASE WHEN log.status_code >= 400 THEN 1 ELSE 0 END)", "error_count")
			.where("log.client_id = :clientId", { clientId })
			.andWhere("log.timestamp >= :startDate", { startDate })
			.groupBy("DATE(log.timestamp)")
			.orderBy("date", "DESC");

		const results = await query.getRawMany();

		return results.map((row) => ({
			date: row.date,
			requestCount: Number.parseInt(row.request_count, 10),
			avgResponseTime: Number.parseFloat(row.avg_response_time),
			errorCount: Number.parseInt(row.error_count, 10),
		}));
	}

	async getTopClients(limit = 10, days = 30): Promise<TopClientResult[]> {
		const startDate = new Date();
		startDate.setDate(startDate.getDate() - days);

		const query = this.repository
			.createQueryBuilder("log")
			.select("log.client_id", "client_id")
			.addSelect("COUNT(*)", "request_count")
			.addSelect("AVG(log.response_time)", "avg_response_time")
			.addSelect("SUM(CASE WHEN log.status_code >= 400 THEN 1 ELSE 0 END)", "error_count")
			.addSelect("MAX(log.timestamp)", "last_access")
			.where("log.timestamp >= :startDate", { startDate })
			.groupBy("log.client_id")
			.orderBy("request_count", "DESC")
			.limit(limit);

		const results = await query.getRawMany();

		return results.map((row) => ({
			clientId: row.client_id,
			requestCount: Number.parseInt(row.request_count, 10),
			avgResponseTime: Number.parseFloat(row.avg_response_time),
			errorCount: Number.parseInt(row.error_count, 10),
			lastAccess: new Date(row.last_access),
		}));
	}

	async getRequestCount(clientId: string, since: Date): Promise<number> {
		return await this.repository.count({
			where: {
				clientId,
				timestamp: Between(since, new Date()),
			},
		});
	}

	async deleteOlderThan(days: number): Promise<number> {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - days);

		const result = await this.repository
			.createQueryBuilder()
			.delete()
			.where("timestamp < :cutoffDate", { cutoffDate })
			.execute();

		return result.affected ?? 0;
	}

	async count(): Promise<number> {
		return await this.repository.count();
	}

	async countByClient(clientId: string): Promise<number> {
		return await this.repository.count({ where: { clientId } });
	}
}

// Export singleton instance
export const apiLogRepository = new ApiLogRepository();

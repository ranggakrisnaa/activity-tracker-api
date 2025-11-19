import { StatusCodes } from "http-status-codes";
import type { Client, RegisterClientResponse } from "@/api/client/clientModel";
import { clientRepository } from "@/repositories/client.repository";
import { apiLogRepository, type DailyUsageResult, type TopClientResult } from "@/repositories/api-log.repository";
import { redisService } from "@/services/redis.service";
import { generateJWT } from "@/utils/auth.utils";
import { env } from "@/common/utils/envConfig";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { logger } from "@/server";

export class ClientService {
	async register(
		name: string,
		email: string,
		rateLimit: number
	): Promise<ServiceResponse<RegisterClientResponse | null>> {
		try {
			// Check if email already exists
			const existingClient = await clientRepository.findByEmail(email);
			if (existingClient) {
				return ServiceResponse.failure("Email already registered", null, StatusCodes.CONFLICT);
			}

			// Create new client
			const client = await clientRepository.create({
				name,
				email,
				rateLimit,
			});

			// Generate JWT token
			const token = generateJWT({
				clientId: client.clientId,
				email: client.email,
				name: client.name,
			});

			// Return client data with plain API key (only shown once)
			const response: RegisterClientResponse = {
				clientId: client.clientId,
				name: client.name,
				email: client.email,
				apiKey: client.apiKey, // Plain text API key from repository
				token,
				rateLimit: client.rateLimit,
				createdAt: client.createdAt,
			};

			return ServiceResponse.success<RegisterClientResponse>("Client registered successfully", response);
		} catch (ex) {
			const errorMessage = `Error registering client: ${(ex as Error).message}`;
			logger.error(errorMessage);
			return ServiceResponse.failure(
				"An error occurred while registering client.",
				null,
				StatusCodes.INTERNAL_SERVER_ERROR
			);
		}
	}

	async findByClientId(clientId: string): Promise<ServiceResponse<Client | null>> {
		try {
			const client = await clientRepository.findByClientId(clientId);
			if (!client) {
				return ServiceResponse.failure("Client not found", null, StatusCodes.NOT_FOUND);
			}

			const clientData: Client = {
				clientId: client.clientId,
				name: client.name,
				email: client.email,
				isActive: client.isActive,
				rateLimit: client.rateLimit,
				createdAt: client.createdAt,
				lastAccessAt: client.lastAccessAt,
			};

			return ServiceResponse.success<Client>("Client found", clientData);
		} catch (ex) {
			const errorMessage = `Error finding client ${clientId}: ${(ex as Error).message}`;
			logger.error(errorMessage);
			return ServiceResponse.failure(
				"An error occurred while finding client.",
				null,
				StatusCodes.INTERNAL_SERVER_ERROR
			);
		}
	}

	async findAllActive(): Promise<ServiceResponse<Client[] | null>> {
		try {
			const clients = await clientRepository.findAllActive();

			if (!clients || clients.length === 0) {
				return ServiceResponse.failure("No active clients found", null, StatusCodes.NOT_FOUND);
			}

			const clientData: Client[] = clients.map((client) => ({
				clientId: client.clientId,
				name: client.name,
				email: client.email,
				isActive: client.isActive,
				rateLimit: client.rateLimit,
				createdAt: client.createdAt,
				lastAccessAt: client.lastAccessAt,
			}));

			return ServiceResponse.success<Client[]>("Clients found", clientData);
		} catch (ex) {
			const errorMessage = `Error finding all clients: ${(ex as Error).message}`;
			logger.error(errorMessage);
			return ServiceResponse.failure(
				"An error occurred while retrieving clients.",
				null,
				StatusCodes.INTERNAL_SERVER_ERROR
			);
		}
	}

	async logApiHit(
		clientId: string,
		data: {
			apiKey: string;
			endpoint: string;
			method: string;
			statusCode: number;
			responseTime?: number;
			ipAddress?: string;
			userAgent?: string;
		}
	): Promise<ServiceResponse<null>> {
		try {
			// Client already authenticated by middleware, just log the hit
			await apiLogRepository.addToBatch({
				clientId: clientId,
				apiKey: data.apiKey,
				endpoint: data.endpoint,
				method: data.method,
				statusCode: data.statusCode,
				responseTime: data.responseTime || 0,
				ipAddress: data.ipAddress || "unknown",
				userAgent: data.userAgent,
			});

			return ServiceResponse.success("API hit logged successfully", null, StatusCodes.CREATED);
		} catch (ex) {
			const errorMessage = `Error logging API hit: ${(ex as Error).message}`;
			logger.error(errorMessage);
			return ServiceResponse.failure(
				"An error occurred while logging API hit.",
				null,
				StatusCodes.INTERNAL_SERVER_ERROR
			);
		}
	}

	async getDailyUsage(days: number): Promise<ServiceResponse<DailyUsageResult[]>> {
		try {
			const cacheKey = `usage:daily:${days}`;

			// Try to get from cache first
			const cached = await redisService.getJSON<DailyUsageResult[]>(cacheKey);
			if (cached && cached.length > 0) {
				logger.info({ cacheKey }, "Daily usage retrieved from cache");
				return ServiceResponse.success("Daily usage retrieved from cache", cached);
			}

			// Get all clients and aggregate their usage
			const clients = await clientRepository.findAllActive();
			const allUsageData: Map<string, DailyUsageResult> = new Map();

			// Aggregate usage across all clients
			for (const client of clients) {
				const clientUsage = await apiLogRepository.getDailyUsage(client.clientId, days);

				for (const usage of clientUsage) {
					const existing = allUsageData.get(usage.date);
					if (existing) {
						// Aggregate data for the same date
						existing.requestCount += usage.requestCount;
						existing.errorCount += usage.errorCount;
						// Calculate weighted average for response time
						const totalRequests = existing.requestCount + usage.requestCount;
						existing.avgResponseTime =
							(existing.avgResponseTime * existing.requestCount + usage.avgResponseTime * usage.requestCount) /
							totalRequests;
					} else {
						allUsageData.set(usage.date, { ...usage });
					}
				}
			}

			// Convert map to array and sort by date descending
			const result = Array.from(allUsageData.values()).sort(
				(a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
			);

			// Cache the result (only if there's data)
			if (result.length > 0) {
				await redisService.setJSON(cacheKey, result, env.CACHE_TTL_USAGE_DAILY);
			}

			return ServiceResponse.success("Daily usage retrieved successfully", result);
		} catch (ex) {
			const errorMessage = `Error getting daily usage: ${(ex as Error).message}`;
			logger.error({ error: ex, days }, errorMessage);
			return ServiceResponse.failure(
				"An error occurred while retrieving daily usage.",
				[],
				StatusCodes.INTERNAL_SERVER_ERROR
			);
		}
	}

	async getTopClients(hours: number, limit: number): Promise<ServiceResponse<TopClientResult[]>> {
		try {
			const cacheKey = `usage:top:${hours}:${limit}`;

			// Try to get from cache first
			const cached = await redisService.getJSON<TopClientResult[]>(cacheKey);
			if (cached && cached.length > 0) {
				logger.info({ cacheKey }, "Top clients retrieved from cache");
				return ServiceResponse.success("Top clients retrieved from cache", cached);
			}

			// Get top clients from database (directly using hours)
			const topClients = await apiLogRepository.getTopClients(limit, hours);

			// Cache the result (even if empty, to avoid repeated queries)
			if (topClients.length > 0) {
				await redisService.setJSON(cacheKey, topClients, env.CACHE_TTL_USAGE_TOP);
			}

			return ServiceResponse.success("Top clients retrieved successfully", topClients);
		} catch (ex) {
			const errorMessage = `Error getting top clients: ${(ex as Error).message}`;
			logger.error({ error: ex, hours, limit }, errorMessage);
			return ServiceResponse.failure(
				"An error occurred while retrieving top clients.",
				[],
				StatusCodes.INTERNAL_SERVER_ERROR
			);
		}
	}
}

export const clientService = new ClientService();

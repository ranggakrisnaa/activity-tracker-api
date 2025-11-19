import { StatusCodes } from "http-status-codes";
import type { Client, RegisterClientResponse } from "@/api/client/clientModel";
import { clientRepository } from "@/repositories/client.repository";
import { apiLogRepository, type DailyUsageResult, type TopClientResult } from "@/repositories/api-log.repository";
import { redisService } from "@/services/redis.service";
import { cacheHitTracker } from "@/services/cache-hit-tracker.service";
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

			// Publish real-time update via Redis Pub/Sub
			const logEvent = {
				clientId,
				endpoint: data.endpoint,
				method: data.method,
				statusCode: data.statusCode,
				responseTime: data.responseTime || 0,
				timestamp: new Date(),
			};

			// Fire and forget - don't block the response
			redisService.publish("api:log:new", JSON.stringify(logEvent)).catch((error) => {
				logger.error({ error }, "Failed to publish log event");
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
		const cacheKey = `usage:daily:${days}`;

		try {
			// Try to get from cache first (with graceful fallback)
			try {
				const cached = await redisService.getJSON<DailyUsageResult[]>(cacheKey);
				if (cached && cached.length > 0) {
					logger.info({ cacheKey }, "Daily usage retrieved from cache");
					// Track cache HIT using INCRBY
					if (env.CACHE_HIT_TRACKING_ENABLED) {
						cacheHitTracker.trackAccess(cacheKey, true).catch(() => {});
					}
					return ServiceResponse.success("Daily usage retrieved from cache", cached);
				}
			} catch (cacheError) {
				logger.warn({ error: cacheError, cacheKey }, "Cache read failed, falling back to database");
			}

			// Track cache MISS using INCRBY
			if (env.CACHE_HIT_TRACKING_ENABLED) {
				cacheHitTracker.trackAccess(cacheKey, false).catch(() => {});
			}

			// Get all clients and their individual usage (fallback to database)
			const clients = await clientRepository.findAllActive();
			const allUsageData: DailyUsageResult[] = [];

			// Collect usage from all clients (no aggregation, show per-client data)
			for (const client of clients) {
				const clientUsage = await apiLogRepository.getDailyUsage(client.clientId, days);
				allUsageData.push(...clientUsage);
			}

			// Sort by date descending, then by request count descending
			const result = allUsageData.sort((a, b) => {
				const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
				if (dateCompare !== 0) return dateCompare;
				return b.requestCount - a.requestCount;
			});
			if (result.length > 0) {
				try {
					await redisService.setJSON(cacheKey, result, env.CACHE_TTL_USAGE_DAILY);
				} catch (cacheError) {
					logger.warn({ error: cacheError, cacheKey }, "Failed to write to cache, continuing with response");
				}
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
		const cacheKey = `usage:top:${hours}:${limit}`;

		try {
			// Try to get from cache first (with graceful fallback)
			try {
				const cached = await redisService.getJSON<TopClientResult[]>(cacheKey);
				if (cached && cached.length > 0) {
					// Track cache HIT using INCRBY
					if (env.CACHE_HIT_TRACKING_ENABLED) {
						cacheHitTracker.trackAccess(cacheKey, true).catch(() => {});
					}
					return ServiceResponse.success("Top clients retrieved from cache", cached);
				}
			} catch (cacheError) {
				logger.warn({ error: cacheError, cacheKey }, "Cache read failed, falling back to database");
			}

			// Track cache MISS using INCRBY
			if (env.CACHE_HIT_TRACKING_ENABLED) {
				cacheHitTracker.trackAccess(cacheKey, false).catch(() => {});
			}

			// Get top clients from database (directly using hours)
			const topClients = await apiLogRepository.getTopClients(limit, hours);

			// Cache the result (even if empty, to avoid repeated queries) - gracefully handle cache write failures
			if (topClients.length > 0) {
				try {
					await redisService.setJSON(cacheKey, topClients, env.CACHE_TTL_USAGE_TOP);
				} catch (cacheError) {
					logger.warn({ error: cacheError, cacheKey }, "Failed to write to cache, continuing with response");
				}
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

	async prewarmDailyUsage(days: number): Promise<void> {
		const cacheKey = `usage:daily:${days}`;

		try {
			// Get fresh data from database (skip cache read)
			const clients = await clientRepository.findAllActive();
			const allUsageData: DailyUsageResult[] = [];

			for (const client of clients) {
				const clientUsage = await apiLogRepository.getDailyUsage(client.clientId, days);
				allUsageData.push(...clientUsage);
			}

			// Sort by date descending, then by request count descending
			const result = allUsageData.sort((a, b) => {
				const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
				if (dateCompare !== 0) return dateCompare;
				return b.requestCount - a.requestCount;
			});

			// Write to cache
			if (result.length > 0) {
				await redisService.setJSON(cacheKey, result, env.CACHE_TTL_USAGE_DAILY);
				logger.info({ cacheKey, days, recordCount: result.length }, "Pre-warmed daily usage cache");
			}
		} catch (error) {
			logger.warn({ error, days }, "Failed to pre-warm daily usage cache");
			throw error;
		}
	}

	async prewarmTopClients(hours: number, limit: number): Promise<void> {
		const cacheKey = `usage:top:${hours}:${limit}`;

		try {
			// Get fresh data from database (skip cache read)
			const topClients = await apiLogRepository.getTopClients(limit, hours);

			// Write to cache
			if (topClients.length > 0) {
				await redisService.setJSON(cacheKey, topClients, env.CACHE_TTL_USAGE_TOP);
				logger.info({ cacheKey, hours, limit, recordCount: topClients.length }, "Pre-warmed top clients cache");
			}
		} catch (error) {
			logger.warn({ error, hours, limit }, "Failed to pre-warm top clients cache");
			throw error;
		}
	}

	async streamUsageUpdates(
		clientId: string,
		channel: string,
		writeFn: (data: string) => void,
		onClose: (cleanup: () => void) => void
	): Promise<void> {
		logger.info({ clientId, channel }, "SSE client connected");

		// Send initial connection event
		writeFn(`event: connected\n`);
		writeFn(`data: ${JSON.stringify({ clientId, channel, timestamp: new Date() })}\n\n`);

		// Set up interval to send heartbeat (every 30 seconds)
		const heartbeatInterval = setInterval(() => {
			writeFn(`: heartbeat ${Date.now()}\n\n`);
		}, 30000);

		// Set up interval to send usage updates (every 10 seconds)
		const updateInterval = setInterval(async () => {
			try {
				// Send daily usage update if subscribed
				if (channel === "all" || channel === "daily") {
					const dailyUsage = await this.getDailyUsage(7);
					if (dailyUsage.success && dailyUsage.responseObject) {
						writeFn(`event: usage:daily:update\n`);
						writeFn(`data: ${JSON.stringify(dailyUsage.responseObject)}\n\n`);
					}
				}

				// Send top clients update if subscribed
				if (channel === "all" || channel === "top") {
					const topClients = await this.getTopClients(24, 3);
					if (topClients.success && topClients.responseObject) {
						writeFn(`event: usage:top:update\n`);
						writeFn(`data: ${JSON.stringify(topClients.responseObject)}\n\n`);
					}
				}
			} catch (error) {
				logger.error({ error, clientId }, "Error sending SSE update");
			}
		}, 10000);

		// Register cleanup callback
		onClose(() => {
			clearInterval(heartbeatInterval);
			clearInterval(updateInterval);
			logger.info({ clientId, channel }, "SSE client disconnected");
		});
	}
}

export const clientService = new ClientService();

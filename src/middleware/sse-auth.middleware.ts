import type { Request, Response, NextFunction } from "express";
import { verifyJWT } from "@/utils/auth.utils";
import { compareAPIKey } from "@/utils/crypto.utils";
import { AppDataSource } from "@/database/data-source";
import { Client } from "@/database/entities/client.entity";
import { logger } from "@/server";

/**
 * SSE authentication middleware
 * Authenticates via query parameters for SSE connections
 */
export async function authenticateSSE(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const token = req.query.token as string;
		const apiKey = req.query.apiKey as string;

		// Try JWT authentication
		if (token) {
			const result = verifyJWT(token);
			if (result.expired || !result.payload) {
				res.status(401).json({
					success: false,
					message: "Token expired or invalid",
				});
				return;
			}

			// Verify client exists and is active
			const clientRepo = AppDataSource.getRepository(Client);
			const client = await clientRepo.findOne({
				where: { clientId: result.payload.clientId },
			});

			if (!client || !client.isActive) {
				res.status(401).json({
					success: false,
					message: "Invalid or inactive client",
				});
				return;
			}

			req.client = {
				clientId: client.clientId,
				email: client.email,
				name: client.name,
			};

			return next();
		}

		// Try API Key authentication
		if (apiKey) {
			const clientRepo = AppDataSource.getRepository(Client);
			const clients = await clientRepo.find({
				where: { isActive: true },
				select: ["id", "clientId", "email", "name", "apiKeyHash"],
			});

			let matchedClient: Client | null = null;
			for (const client of clients) {
				if (client.apiKeyHash) {
					const isMatch = await compareAPIKey(apiKey, client.apiKeyHash);
					if (isMatch) {
						matchedClient = client;
						break;
					}
				}
			}

			if (!matchedClient) {
				res.status(401).json({
					success: false,
					message: "Invalid API key",
				});
				return;
			}

			req.client = {
				clientId: matchedClient.clientId,
				email: matchedClient.email,
				name: matchedClient.name,
			};

			return next();
		}

		res.status(401).json({
			success: false,
			message: "Authentication required. Provide token or apiKey query parameter.",
		});
	} catch (error) {
		logger.error({ error }, "SSE authentication error");
		res.status(401).json({
			success: false,
			message: "Authentication failed",
		});
	}
}

import type { Request, Response, NextFunction } from "express";
import { verifyJWT } from "@/utils/auth.utils";
import { compareAPIKey } from "@/utils/crypto.utils";
import { AppDataSource } from "@/database/data-source";
import { Client } from "@/database/entities/client.entity";
import { logger } from "@/server";

export async function authenticateJWT(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const authHeader = req.headers.authorization;

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			res.status(401).json({
				success: false,
				message: "Authentication required. Please provide a valid JWT token.",
			});
			return;
		}

		const token = authHeader.substring(7);

		// Verify JWT
		const result = verifyJWT(token);

		if (result.expired) {
			res.status(401).json({
				success: false,
				message: "Token has expired. Please obtain a new token.",
			});
			return;
		}

		// Verify client exists and is active
		const clientRepo = AppDataSource.getRepository(Client);
		const client = await clientRepo.findOne({
			where: { clientId: result.payload.clientId },
		});

		if (!client) {
			res.status(401).json({
				success: false,
				message: "Invalid client credentials.",
			});
			return;
		}

		if (!client.isActive) {
			res.status(403).json({
				success: false,
				message: "Client account is inactive. Please contact support.",
			});
			return;
		}

		// Update last access time (fire and forget)
		clientRepo
			.update({ id: client.id }, { lastAccessAt: new Date() })
			.catch((error) => console.error("Failed to update lastAccessAt:", error));

		// Attach client info to request
		req.client = {
			clientId: client.clientId,
			email: client.email,
			name: client.name,
		};

		next();
	} catch (error) {
		logger.error({ error }, "JWT authentication error");
		res.status(401).json({
			success: false,
			message: "Invalid or malformed token.",
		});
	}
}

export async function authenticateAPIKey(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const apiKey = req.headers["x-api-key"] as string;

		if (!apiKey) {
			res.status(401).json({
				success: false,
				message: "API key required. Please provide X-API-Key header.",
			});
			return;
		}

		// Find client by API key (stored in encrypted form)
		const clientRepo = AppDataSource.getRepository(Client);

		// Fetch all active clients to compare API keys
		const clients = await clientRepo.find({
			where: { isActive: true },
			select: ["id", "clientId", "email", "name", "apiKey", "apiKeyHash"],
		});

		let matchedClient: Client | null = null;

		// Compare API key hash
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
				message: "Invalid API key.",
			});
			return;
		}

		// Update last access time (fire and forget)
		clientRepo
			.update({ id: matchedClient.id }, { lastAccessAt: new Date() })
			.catch((error) => console.error("Failed to update lastAccessAt:", error));

		// Attach client info to request
		req.client = {
			clientId: matchedClient.clientId,
			email: matchedClient.email,
			name: matchedClient.name,
			apiKey: apiKey, // Store for rate limiting
		};

		next();
	} catch (error) {
		console.error("API Key authentication error:", error);
		res.status(500).json({
			success: false,
			message: "Internal server error during authentication.",
		});
	}
}

/**
 * Combined middleware: Try JWT first, then API Key
 * Useful for endpoints that accept both authentication methods
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
	const hasJWT = req.headers.authorization?.startsWith("Bearer ");
	const hasAPIKey = !!req.headers["x-api-key"];

	if (hasJWT) {
		// Try JWT authentication
		return authenticateJWT(req, res, next);
	}

	if (hasAPIKey) {
		// Try API Key authentication
		return authenticateAPIKey(req, res, next);
	}

	// No authentication provided
	res.status(401).json({
		success: false,
		message: "Authentication required. Provide either JWT token (Authorization: Bearer) or API Key (X-API-Key).",
	});
}

/**
 * Middleware to require authentication (alias for authenticate)
 */
export const requireAuth = authenticate;

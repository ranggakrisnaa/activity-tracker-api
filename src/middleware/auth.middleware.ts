import type { Request, Response, NextFunction } from "express";
import { verifyJWT, type JWTPayload } from "@/utils/auth.utils";
import { compareAPIKey } from "@/utils/crypto.utils";
import { AppDataSource } from "@/database/data-source";
import { Client } from "@/database/entities/client.entity";

// Extend Express Request to include authenticated client info
declare global {
	namespace Express {
		interface Request {
			client?: {
				id: string;
				clientId: string;
				email: string;
				name: string;
				apiKey?: string;
			};
		}
	}
}

/**
 * Middleware to authenticate requests using JWT token
 * Expects: Authorization: Bearer <token>
 */
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

		const token = authHeader.substring(7); // Remove 'Bearer ' prefix

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
			id: client.id,
			clientId: client.clientId,
			email: client.email,
			name: client.name,
		};

		next();
	} catch (error) {
		res.status(401).json({
			success: false,
			message: "Invalid or malformed token.",
		});
	}
}

/**
 * Middleware to authenticate requests using API Key
 * Expects: X-API-Key: <key> header
 */
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
		// We'll need to query all clients and compare hashes (not efficient for large scale)
		// Better approach: Use a separate index or cache for API keys
		const clientRepo = AppDataSource.getRepository(Client);

		// For now, we'll fetch clients with apiKey not null and compare
		// In production, consider indexing or caching this
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
			id: matchedClient.id,
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

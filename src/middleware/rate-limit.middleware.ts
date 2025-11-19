import type { Request, Response, NextFunction } from "express";
import { rateLimiterService } from "@/services/rate-limiter.service";
import { logger } from "@/server";

/**
 * Rate limiting middleware for authenticated clients
 */
export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
	// Check if client is authenticated
	if (!req.client?.clientId) {
		// If no client, skip rate limiting (let auth middleware handle it)
		next();
		return;
	}

	try {
		// Use per-client rate limit if available, otherwise use global config
		const clientRateLimit = req.client.rateLimit || rateLimiterService.getConfig().maxRequests;

		logger.debug(
			{ clientId: req.client.clientId, clientRateLimit, fromDB: !!req.client.rateLimit },
			"Checking rate limit"
		);

		const result = await rateLimiterService.checkRateLimit(req.client.clientId, clientRateLimit);

		// Set rate limit headers
		res.setHeader("X-RateLimit-Limit", clientRateLimit);
		res.setHeader("X-RateLimit-Remaining", result.remaining);
		res.setHeader("X-RateLimit-Reset", result.resetAt.toISOString());
		res.setHeader("X-RateLimit-Window", `${rateLimiterService.getConfig().windowSize}s`);

		if (!result.allowed) {
			// Rate limit exceeded
			const retryAfter = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000);
			res.setHeader("Retry-After", retryAfter);

			res.status(429).json({
				success: false,
				message: "Rate limit exceeded. Please try again later.",
				error: {
					code: "RATE_LIMIT_EXCEEDED",
					limit: clientRateLimit,
					current: result.current,
					resetAt: result.resetAt.toISOString(),
					retryAfter: `${retryAfter}s`,
				},
			});
			return;
		}

		// Rate limit OK, proceed
		next();
	} catch (error) {
		// On error, log but allow the request (fail open)
		// This ensures availability over strict rate limiting
		logger.error({ error, clientId: req.client?.clientId }, "Rate limit middleware error");
		next();
	}
}

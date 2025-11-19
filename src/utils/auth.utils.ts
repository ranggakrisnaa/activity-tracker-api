import jwt from "jsonwebtoken";
import { env } from "@/common/utils/envConfig";

export interface JWTPayload {
	clientId: string;
	email: string;
	name: string;
}

export interface JWTVerifyResult {
	payload: JWTPayload;
	expired: boolean;
}

/**
 * Generate JWT token for authenticated client
 */
export function generateJWT(payload: JWTPayload): string {
	return jwt.sign(payload, env.JWT_SECRET, {
		expiresIn: env.JWT_EXPIRES_IN as string | number,
		issuer: "nexmedis-api",
		audience: "nexmedis-clients",
	} as jwt.SignOptions);
}

/**
 * Verify and decode JWT token
 */
export function verifyJWT(token: string): JWTVerifyResult {
	try {
		const decoded = jwt.verify(token, env.JWT_SECRET, {
			issuer: "nexmedis-api",
			audience: "nexmedis-clients",
		}) as JWTPayload;

		return {
			payload: decoded,
			expired: false,
		};
	} catch (error) {
		if (error instanceof jwt.TokenExpiredError) {
			// Token expired, try to decode without verification to get payload
			const decoded = jwt.decode(token) as JWTPayload | null;
			if (decoded) {
				return {
					payload: decoded,
					expired: true,
				};
			}
		}

		throw error;
	}
}

/**
 * Decode JWT token without verification (for debugging)
 */
export function decodeJWT(token: string): JWTPayload | null {
	return jwt.decode(token) as JWTPayload | null;
}

/**
 * Refresh JWT token if it's about to expire (within 5 minutes)
 */
export function refreshJWTIfNeeded(token: string): string | null {
	try {
		const decoded = jwt.decode(token) as jwt.JwtPayload | null;
		if (!decoded || !decoded.exp) return null;

		const expirationTime = decoded.exp * 1000; // Convert to milliseconds
		const currentTime = Date.now();
		const timeUntilExpiration = expirationTime - currentTime;
		const fiveMinutes = 5 * 60 * 1000;

		// Refresh if token expires within 5 minutes
		if (timeUntilExpiration < fiveMinutes && timeUntilExpiration > 0) {
			const payload: JWTPayload = {
				clientId: decoded.clientId as string,
				email: decoded.email as string,
				name: decoded.name as string,
			};
			return generateJWT(payload);
		}

		return null;
	} catch (error) {
		return null;
	}
}

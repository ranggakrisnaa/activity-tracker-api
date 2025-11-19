import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

// Client Schema (response)
export type Client = z.infer<typeof ClientSchema>;
export const ClientSchema = z.object({
	clientId: z.string().openapi({ example: "CL-ABC123XYZ" }),
	name: z.string().openapi({ example: "Acme Corporation" }),
	email: z.string().email().openapi({ example: "api@acme.com" }),
	apiKey: z.string().optional().openapi({ example: "sk_live_abc123..." }),
	token: z.string().optional().openapi({ example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }),
	isActive: z.boolean(),
	rateLimit: z.number().int().positive().openapi({ example: 1000 }),
	createdAt: z.date(),
	lastAccessAt: z.date().nullable(),
});

// Register Client Response Schema (flat object for service layer)
export type RegisterClientResponse = z.infer<typeof RegisterClientResponseSchema>;
export const RegisterClientResponseSchema = z.object({
	clientId: z.string().openapi({ example: "CL-ABC123XYZ" }),
	name: z.string().openapi({ example: "Acme Corporation" }),
	email: z.string().email().openapi({ example: "api@acme.com" }),
	apiKey: z.string().openapi({ example: "sk_live_abc123..." }),
	token: z.string().openapi({ example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }),
	rateLimit: z.number().int().positive().openapi({ example: 1000 }),
	createdAt: z.date(),
});

// Input Validation for 'POST /api/register' endpoint
export const RegisterClientSchema = z.object({
	body: z.object({
		name: z.string().min(1).max(255).openapi({ example: "Acme Corporation" }),
		email: z.string().email().openapi({ example: "api@acme.com" }),
		rateLimit: z.number().int().positive().optional().default(1000).openapi({ example: 1000 }),
	}),
});

// API Log Schema
export type ApiLog = z.infer<typeof ApiLogSchema>;
export const ApiLogSchema = z.object({
	clientId: z.string().openapi({ example: "CL-ABC123XYZ" }),
	apiKey: z.string().openapi({ example: "sk_live_abc123..." }),
	endpoint: z.string().openapi({ example: "/api/users" }),
	method: z.string().openapi({ example: "GET" }),
	statusCode: z.number().int().openapi({ example: 200 }),
	responseTime: z.number().int().openapi({ example: 45 }),
	ipAddress: z.string().openapi({ example: "192.168.1.1" }),
	userAgent: z.string().optional(),
	timestamp: z.date(),
});

// Input Validation for 'POST /api/logs' endpoint
export const LogApiHitSchema = z.object({
	body: z.object({
		endpoint: z.string().min(1).openapi({ example: "/api/users" }),
		method: z.string().min(1).openapi({ example: "GET" }),
		statusCode: z.number().int().openapi({ example: 200 }),
		responseTime: z.number().int().optional().openapi({ example: 45 }),
		ipAddress: z.string().optional(),
		userAgent: z.string().optional(),
	}),
});

// Daily Usage Schema
export type DailyUsage = z.infer<typeof DailyUsageSchema>;
export const DailyUsageSchema = z.object({
	date: z.string().openapi({ example: "2025-01-15" }),
	requestCount: z.number().int().openapi({ example: 1250 }),
	avgResponseTime: z.number().openapi({ example: 45.6 }),
	errorCount: z.number().int().openapi({ example: 12 }),
});

// Input Validation for 'GET /api/usage/daily' endpoint
export const GetDailyUsageSchema = z.object({
	query: z.object({
		days: z.string().optional().openapi({ example: "7" }),
	}),
});

// Top Clients Schema
export type TopClient = z.infer<typeof TopClientSchema>;
export const TopClientSchema = z.object({
	clientId: z.string().openapi({ example: "CL-ABC123XYZ" }),
	requestCount: z.number().int().openapi({ example: 5420 }),
	avgResponseTime: z.number().openapi({ example: 52.3 }),
	errorCount: z.number().int().openapi({ example: 45 }),
	lastAccess: z.date(),
});

// Input Validation for 'GET /api/usage/top' endpoint
export const GetTopClientsSchema = z.object({
	query: z.object({
		hours: z.string().optional().openapi({ example: "24" }),
		limit: z.string().optional().openapi({ example: "3" }),
	}),
});

// Input Validation for 'PATCH /api/clients/:clientId/deactivate' endpoint
export const DeactivateClientSchema = z.object({
	params: z.object({
		clientId: z.string().min(1),
	}),
});

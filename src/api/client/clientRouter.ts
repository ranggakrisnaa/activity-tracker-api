import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Router } from "express";
import { z } from "zod";
import {
	RegisterClientSchema,
	RegisterClientResponseSchema,
	LogApiHitSchema,
	GetDailyUsageSchema,
	DailyUsageSchema,
	GetTopClientsSchema,
	TopClientSchema,
} from "@/api/client/clientModel";
import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
import { validateRequest } from "@/common/utils/httpHandlers";
import { authenticate, authenticateAPIKey } from "@/middleware/auth.middleware";
import { authenticateSSE } from "@/middleware/sse-auth.middleware";
import { rateLimitMiddleware } from "@/middleware/rate-limit.middleware";
import { clientController } from "./clientController";

const clientRegistry = new OpenAPIRegistry();
const clientRouter: Router = express.Router();

// Register schemas for OpenAPI
clientRegistry.register("RegisterClientResponse", RegisterClientResponseSchema);
clientRegistry.register("DailyUsage", DailyUsageSchema);
clientRegistry.register("TopClient", TopClientSchema);

// POST /api/register - Register a new client
clientRegistry.registerPath({
	method: "post",
	path: "/api/register",
	tags: ["Client"],
	request: {
		body: {
			content: {
				"application/json": {
					schema: RegisterClientSchema.shape.body,
				},
			},
		},
	},
	responses: createApiResponse(RegisterClientResponseSchema, "Client registered successfully"),
});

clientRouter.post("/register", validateRequest(RegisterClientSchema), clientController.register);

// POST /api/logs - Record an API hit
clientRegistry.registerPath({
	method: "post",
	path: "/api/logs",
	security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
	tags: ["Logging"],
	request: {
		body: {
			content: {
				"application/json": {
					schema: LogApiHitSchema.shape.body,
				},
			},
		},
	},
	responses: createApiResponse(z.object({ success: z.boolean(), message: z.string() }), "API hit logged successfully"),
});

clientRouter.post(
	"/logs",
	authenticateAPIKey,
	rateLimitMiddleware,
	validateRequest(LogApiHitSchema),
	clientController.logApiHit
);

// GET /api/usage/daily - Fetch daily usage for last 7 days per client
clientRegistry.registerPath({
	method: "get",
	path: "/api/usage/daily",
	tags: ["Usage Analytics"],
	security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
	request: {
		query: GetDailyUsageSchema.shape.query,
	},
	responses: createApiResponse(
		z.object({
			success: z.boolean(),
			data: z.array(DailyUsageSchema),
		}),
		"Daily usage retrieved successfully"
	),
});

clientRouter.get(
	"/usage/daily",
	authenticate,
	authenticateAPIKey,
	rateLimitMiddleware,
	validateRequest(GetDailyUsageSchema),
	clientController.getDailyUsage
);

// GET /api/usage/top - Fetch top 3 clients in last 24 hours
clientRegistry.registerPath({
	method: "get",
	path: "/api/usage/top",
	tags: ["Usage Analytics"],
	security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
	request: {
		query: GetTopClientsSchema.shape.query,
	},
	responses: createApiResponse(
		z.object({
			success: z.boolean(),
			data: z.array(TopClientSchema),
		}),
		"Top clients retrieved successfully"
	),
});

clientRouter.get(
	"/usage/top",
	authenticate,
	authenticateAPIKey,
	rateLimitMiddleware,
	validateRequest(GetTopClientsSchema),
	clientController.getTopClients
);

// GET /api/usage/stream - Server-Sent Events endpoint for real-time updates
clientRegistry.registerPath({
	method: "get",
	path: "/api/usage/stream",
	tags: ["Usage Analytics", "Real-time"],
	security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
	request: {
		query: z.object({
			token: z.string().optional().openapi({ example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }),
			apiKey: z.string().optional().openapi({ example: "sk_live_abc123..." }),
			channel: z
				.enum(["all", "logs", "daily", "top"])
				.optional()
				.openapi({ example: "all", description: "Channel to subscribe: all, logs, daily, or top" }),
		}),
	},
	responses: {
		200: {
			description: "SSE stream established. Events: connected, log:new, usage:daily:update, usage:top:update",
			content: {
				"text/event-stream": {
					schema: z.object({
						event: z.string(),
						data: z.unknown(),
					}),
				},
			},
		},
		401: {
			description: "Unauthorized - Invalid or missing authentication",
		},
	},
});

clientRouter.get("/usage/stream", authenticateSSE, clientController.streamUsageUpdates);

export { clientRegistry, clientRouter };

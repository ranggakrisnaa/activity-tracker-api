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
import { clientController } from "./clientController";

export const clientRegistry = new OpenAPIRegistry();
export const clientRouter: Router = express.Router();

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

clientRouter.post("/logs", authenticateAPIKey, validateRequest(LogApiHitSchema), clientController.logApiHit);

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
	validateRequest(GetTopClientsSchema),
	clientController.getTopClients
);

import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";

import { healthCheckRegistry } from "@/api/healthCheck/healthCheckRouter";
import { clientRegistry } from "@/api/client/clientRouter";

export type OpenAPIDocument = ReturnType<OpenApiGeneratorV3["generateDocument"]>;

export function generateOpenAPIDocument(): OpenAPIDocument {
	const registry = new OpenAPIRegistry([healthCheckRegistry, clientRegistry]);

	// Register security schemes
	registry.registerComponent("securitySchemes", "bearerAuth", {
		type: "http",
		scheme: "bearer",
		bearerFormat: "JWT",
		description: "JWT token obtained from registration or login",
	});

	registry.registerComponent("securitySchemes", "apiKeyAuth", {
		type: "apiKey",
		in: "header",
		name: "X-API-Key",
		description: "API key obtained during client registration",
	});

	const generator = new OpenApiGeneratorV3(registry.definitions);

	return generator.generateDocument({
		openapi: "3.0.0",
		info: {
			version: "1.0.0",
			title: "Activity Tracker API",
			description: "API for tracking client activity with authentication and rate limiting",
		},
		externalDocs: {
			description: "View the raw OpenAPI Specification in JSON format",
			url: "/swagger.json",
		},
	});
}

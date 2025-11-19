import type { Request, RequestHandler, Response } from "express";
import { clientService } from "./clientService";

class ClientController {
	public register: RequestHandler = async (req: Request, res: Response) => {
		const { name, email, rateLimit } = req.body;
		const serviceResponse = await clientService.register(name, email, rateLimit || 1000);
		res.status(serviceResponse.statusCode).send(serviceResponse);
	};

	public getClient: RequestHandler = async (req: Request, res: Response) => {
		const { clientId } = req.params;
		const serviceResponse = await clientService.findByClientId(clientId);
		res.status(serviceResponse.statusCode).send(serviceResponse);
	};

	public getAllClients: RequestHandler = async (_req: Request, res: Response) => {
		const serviceResponse = await clientService.findAllActive();
		res.status(serviceResponse.statusCode).send(serviceResponse);
	};

	public logApiHit: RequestHandler = async (req: Request, res: Response) => {
		const { endpoint, method, statusCode, responseTime, ipAddress, userAgent } = req.body;

		// Get clientId and apiKey from authenticated request
		const clientId = req.client?.clientId;
		const apiKey = req.headers["x-api-key"] as string;

		if (!clientId || !apiKey) {
			res.status(401).send({ success: false, message: "Unauthorized", responseObject: null, statusCode: 401 });
			return;
		}

		const serviceResponse = await clientService.logApiHit(clientId, {
			apiKey,
			endpoint,
			method,
			statusCode,
			responseTime,
			ipAddress: ipAddress || req.ip || "unknown",
			userAgent: userAgent || req.get("user-agent"),
		});
		res.status(serviceResponse.statusCode).send(serviceResponse);
	};

	public getDailyUsage: RequestHandler = async (req: Request, res: Response) => {
		const days = req.query.days ? Number.parseInt(req.query.days as string, 10) : 7;
		const serviceResponse = await clientService.getDailyUsage(days);
		res.status(serviceResponse.statusCode).send(serviceResponse);
	};

	public getTopClients: RequestHandler = async (req: Request, res: Response) => {
		const hours = req.query.hours ? Number.parseInt(req.query.hours as string, 10) : 24;
		const limit = req.query.limit ? Number.parseInt(req.query.limit as string, 10) : 3;
		const serviceResponse = await clientService.getTopClients(hours, limit);
		res.status(serviceResponse.statusCode).send(serviceResponse);
	};

	public streamUsageUpdates: RequestHandler = async (req: Request, res: Response) => {
		const clientId = req.client?.clientId;
		const channel = (req.query.channel as string) || "all";

		if (!clientId) {
			res.status(401).json({ success: false, message: "Unauthorized" });
			return;
		}

		// Set SSE headers
		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.setHeader("X-Accel-Buffering", "no");

		// Stream updates via service
		await clientService.streamUsageUpdates(
			clientId,
			channel,
			(data: string) => res.write(data),
			(cleanup: () => void) => {
				req.on("close", () => {
					cleanup();
					res.end();
				});
			}
		);
	};
}

export const clientController = new ClientController();

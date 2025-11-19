import { Server as HTTPServer } from "node:http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { verifyJWT } from "@/utils/auth.utils";
import { compareAPIKey } from "@/utils/crypto.utils";
import { AppDataSource } from "@/database/data-source";
import { Client } from "@/database/entities/client.entity";
import { logger } from "@/server";
import { env } from "@/common/utils/envConfig";

interface AuthenticatedSocket extends Socket {
	clientId?: string;
	email?: string;
}

export class WebSocketService {
	private io: SocketIOServer | null = null;

	/**
	 * Initialize Socket.io server with authentication
	 */
	initialize(httpServer: HTTPServer): void {
		this.io = new SocketIOServer(httpServer, {
			cors: {
				origin: env.CORS_ORIGIN,
				credentials: true,
			},
			path: "/socket.io/",
		});

		// Authentication middleware
		this.io.use(async (socket: AuthenticatedSocket, next) => {
			try {
				const token = socket.handshake.auth.token;
				const apiKey = socket.handshake.auth.apiKey;

				// Try JWT authentication
				if (token) {
					const result = verifyJWT(token);
					if (result.expired || !result.payload) {
						return next(new Error("Token expired or invalid"));
					}

					// Verify client exists and is active
					const clientRepo = AppDataSource.getRepository(Client);
					const client = await clientRepo.findOne({
						where: { clientId: result.payload.clientId },
					});

					if (!client || !client.isActive) {
						return next(new Error("Invalid or inactive client"));
					}

					socket.clientId = client.clientId;
					socket.email = client.email;
					return next();
				}

				// Try API Key authentication
				if (apiKey) {
					const clientRepo = AppDataSource.getRepository(Client);
					const clients = await clientRepo.find({
						where: { isActive: true },
						select: ["id", "clientId", "email", "apiKeyHash"],
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
						return next(new Error("Invalid API key"));
					}

					socket.clientId = matchedClient.clientId;
					socket.email = matchedClient.email;
					return next();
				}

				return next(new Error("Authentication required"));
			} catch (error) {
				logger.error({ error }, "WebSocket authentication error");
				return next(new Error("Authentication failed"));
			}
		});

		// Connection handler
		this.io.on("connection", (socket: AuthenticatedSocket) => {
			logger.info({ clientId: socket.clientId, socketId: socket.id }, "Client connected via WebSocket");

			// Join client-specific room
			if (socket.clientId) {
				socket.join(`client:${socket.clientId}`);
				socket.join("all-clients");
			}

			// Handle disconnection
			socket.on("disconnect", (reason) => {
				logger.info({ clientId: socket.clientId, socketId: socket.id, reason }, "Client disconnected");
			});

			// Handle subscribe to specific channels
			socket.on("subscribe", (channel: string) => {
				if (channel === "usage:daily" || channel === "usage:top" || channel === "logs") {
					socket.join(channel);
					logger.info({ clientId: socket.clientId, channel }, "Client subscribed to channel");
					socket.emit("subscribed", { channel });
				}
			});

			// Handle unsubscribe
			socket.on("unsubscribe", (channel: string) => {
				socket.leave(channel);
				logger.info({ clientId: socket.clientId, channel }, "Client unsubscribed from channel");
				socket.emit("unsubscribed", { channel });
			});
		});

		logger.info("✅ WebSocket service initialized");
	}

	/**
	 * Broadcast new API log to all connected clients
	 */
	broadcastNewLog(data: {
		clientId: string;
		endpoint: string;
		method: string;
		statusCode: number;
		responseTime: number;
		timestamp: Date;
	}): void {
		if (!this.io) return;

		// Broadcast to all clients subscribed to logs
		this.io.to("logs").emit("log:new", data);

		// Send to specific client room
		this.io.to(`client:${data.clientId}`).emit("log:new", data);
	}

	/**
	 * Broadcast usage update to all connected clients
	 */
	broadcastUsageUpdate(type: "daily" | "top", data: unknown): void {
		if (!this.io) return;

		this.io.to(`usage:${type}`).emit(`usage:${type}:update`, data);
		this.io.to("all-clients").emit("usage:update", { type, data });
	}

	/**
	 * Send usage update to specific client
	 */
	sendToClient(clientId: string, event: string, data: unknown): void {
		if (!this.io) return;

		this.io.to(`client:${clientId}`).emit(event, data);
	}

	/**
	 * Get connected clients count
	 */
	async getConnectedClientsCount(): Promise<number> {
		if (!this.io) return 0;

		const sockets = await this.io.fetchSockets();
		return sockets.length;
	}

	/**
	 * Disconnect all clients and close server
	 */
	close(): void {
		if (this.io) {
			this.io.close();
			this.io = null;
			logger.info("WebSocket service closed");
		}
	}

	/**
	 * Get Socket.io instance
	 */
	getIO(): SocketIOServer | null {
		return this.io;
	}
}

export const websocketService = new WebSocketService();

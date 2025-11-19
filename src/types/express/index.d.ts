// Extend Express Request to include authenticated client info
declare global {
	namespace Express {
		interface Request {
			client?: {
				clientId: string;
				email: string;
				name: string;
				apiKey?: string;
				rateLimit?: number; // Per-client rate limit from database
			};
		}
	}
}

export {};

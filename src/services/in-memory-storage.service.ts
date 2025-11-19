import { logger } from "@/server";
import type { CreateApiLogData } from "@/repositories/api-log.repository";

/**
 * In-memory storage for API logs when database is unavailable
 * This provides graceful degradation during database outages
 */
export class InMemoryLogStorage {
	private logs: CreateApiLogData[] = [];
	private readonly maxSize: number;
	private readonly maxAgeMs: number;
	private cleanupTimer: NodeJS.Timeout | null = null;

	constructor(maxSize = 10000, maxAgeMs = 3600000) {
		// 10k logs, 1 hour retention
		this.maxSize = maxSize;
		this.maxAgeMs = maxAgeMs;
		this.startCleanupTimer();
	}

	/**
	 * Add log to in-memory storage
	 */
	add(log: CreateApiLogData): void {
		// Add timestamp for expiration
		const logWithTimestamp = {
			...log,
			_storedAt: Date.now(),
		};

		this.logs.push(logWithTimestamp as CreateApiLogData);

		// Remove oldest logs if max size exceeded (FIFO)
		if (this.logs.length > this.maxSize) {
			const removed = this.logs.shift();
			logger.warn(
				{ removedLog: removed, totalLogs: this.logs.length },
				"In-memory log storage full, removed oldest log"
			);
		}

		logger.debug({ totalLogs: this.logs.length }, "Log added to in-memory storage");
	}

	/**
	 * Get all logs and clear storage
	 */
	flush(): CreateApiLogData[] {
		const logsToReturn = [...this.logs];
		this.logs = [];
		logger.info({ count: logsToReturn.length }, "Flushed in-memory logs");
		return logsToReturn;
	}

	/**
	 * Get current log count
	 */
	size(): number {
		return this.logs.length;
	}

	/**
	 * Check if storage is empty
	 */
	isEmpty(): boolean {
		return this.logs.length === 0;
	}

	/**
	 * Clear all logs
	 */
	clear(): void {
		const count = this.logs.length;
		this.logs = [];
		logger.info({ count }, "Cleared in-memory log storage");
	}

	/**
	 * Start periodic cleanup of old logs
	 */
	private startCleanupTimer(): void {
		this.cleanupTimer = setInterval(
			() => {
				this.cleanupOldLogs();
			},
			60000 // Cleanup every minute
		);
	}

	/**
	 * Remove logs older than maxAgeMs
	 */
	private cleanupOldLogs(): void {
		const now = Date.now();
		const initialCount = this.logs.length;

		this.logs = this.logs.filter((log: CreateApiLogData & { _storedAt?: number }) => {
			const age = now - (log._storedAt || 0);
			return age < this.maxAgeMs;
		});

		const removedCount = initialCount - this.logs.length;
		if (removedCount > 0) {
			logger.info({ removedCount, remainingLogs: this.logs.length }, "Cleaned up old in-memory logs");
		}
	}

	/**
	 * Stop cleanup timer
	 */
	stop(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}
	}
}

export const inMemoryLogStorage = new InMemoryLogStorage();

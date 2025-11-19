import { logger } from "@/server";

export interface RetryOptions {
	maxRetries?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	retryableErrors?: string[];
	onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Retry a function with exponential backoff
 * @param fn Function to retry
 * @param options Retry configuration
 * @returns Result of the function
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const { maxRetries = 3, baseDelayMs = 100, maxDelayMs = 5000, retryableErrors = [], onRetry } = options;

	let lastError: Error;

	for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error as Error;

			// Don't retry if max attempts reached
			if (attempt > maxRetries) {
				throw lastError;
			}

			// Check if error is retryable
			if (retryableErrors.length > 0) {
				const isRetryable = retryableErrors.some(
					(retryableError) => lastError.message.includes(retryableError) || lastError.name.includes(retryableError)
				);

				if (!isRetryable) {
					throw lastError;
				}
			}

			// Calculate delay with exponential backoff
			const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);

			logger.warn(
				{ error: lastError, attempt, maxRetries, delay },
				`Retry attempt ${attempt}/${maxRetries} after ${delay}ms`
			);

			// Call onRetry callback if provided
			if (onRetry) {
				onRetry(lastError, attempt);
			}

			// Wait before retrying
			await sleep(delay);
		}
	}

	throw lastError!;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if error is a transient database error
 */
export function isTransientDatabaseError(error: Error): boolean {
	const transientErrors = [
		"ECONNREFUSED",
		"ETIMEDOUT",
		"ENOTFOUND",
		"EHOSTUNREACH",
		"connection timeout",
		"connection lost",
		"deadlock",
		"lock timeout",
		"too many connections",
		"QueryFailedError",
	];

	return transientErrors.some(
		(transientError) =>
			error.message.toLowerCase().includes(transientError.toLowerCase()) ||
			error.name.toLowerCase().includes(transientError.toLowerCase())
	);
}

/**
 * Retry database operations with specific configuration
 */
export async function withDatabaseRetry<T>(fn: () => Promise<T>): Promise<T> {
	return withRetry(fn, {
		maxRetries: 3,
		baseDelayMs: 200,
		maxDelayMs: 5000,
		retryableErrors: [
			"ECONNREFUSED",
			"ETIMEDOUT",
			"ENOTFOUND",
			"EHOSTUNREACH",
			"connection timeout",
			"connection lost",
			"deadlock",
			"lock timeout",
			"QueryFailedError",
		],
		onRetry: (error, attempt) => {
			logger.warn({ error, attempt }, "Retrying database operation");
		},
	});
}

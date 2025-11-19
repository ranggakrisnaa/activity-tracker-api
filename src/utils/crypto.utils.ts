import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { env } from "@/common/utils/envConfig";

const ALGORITHM = "aes-256-gcm";
const SALT_ROUNDS = 10;
const IV_LENGTH = 16;

/**
 * Get encryption key from environment variable
 */
function getEncryptionKey(): Buffer {
	const key = env.ENCRYPTION_KEY;
	if (!key) {
		throw new Error("ENCRYPTION_KEY environment variable is not set");
	}

	// Convert hex string to buffer (key must be 32 bytes for AES-256)
	if (key.length !== 64) {
		throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
	}

	return Buffer.from(key, "hex");
}

/**
 * Generate a random API key (32 characters alphanumeric)
 */
export function generateAPIKey(): string {
	return crypto.randomBytes(24).toString("base64url");
}

/**
 * Hash API key using bcrypt (for secure storage)
 */
export async function hashAPIKey(apiKey: string): Promise<string> {
	return await bcrypt.hash(apiKey, SALT_ROUNDS);
}

/**
 * Compare plain API key with hashed version
 */
export async function compareAPIKey(plainKey: string, hashedKey: string): Promise<boolean> {
	return await bcrypt.compare(plainKey, hashedKey);
}

/**
 * Encrypt sensitive data using AES-256-GCM
 */
export function encrypt(text: string): string {
	try {
		const key = getEncryptionKey();
		const iv = crypto.randomBytes(IV_LENGTH);
		const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

		let encrypted = cipher.update(text, "utf8", "hex");
		encrypted += cipher.final("hex");

		const authTag = cipher.getAuthTag();

		// Combine IV + Auth Tag + Encrypted Data (all in hex)
		return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
	} catch (error) {
		throw new Error(`Encryption failed: ${error instanceof Error ? error.message : "Unknown error"}`);
	}
}

/**
 * Decrypt sensitive data using AES-256-GCM
 */
export function decrypt(encryptedData: string): string {
	try {
		const key = getEncryptionKey();
		const parts = encryptedData.split(":");

		if (parts.length !== 3) {
			throw new Error("Invalid encrypted data format");
		}

		const iv = Buffer.from(parts[0], "hex");
		const authTag = Buffer.from(parts[1], "hex");
		const encrypted = parts[2];

		const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
		decipher.setAuthTag(authTag);

		let decrypted = decipher.update(encrypted, "hex", "utf8");
		decrypted += decipher.final("utf8");

		return decrypted;
	} catch (error) {
		throw new Error(`Decryption failed: ${error instanceof Error ? error.message : "Unknown error"}`);
	}
}

/**
 * Hash password using bcrypt (for user authentication if needed)
 */
export async function hashPassword(password: string): Promise<string> {
	return await bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare plain password with hashed version
 */
export async function comparePassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
	return await bcrypt.compare(plainPassword, hashedPassword);
}

/**
 * Generate a random UUID v4
 */
export function generateUUID(): string {
	return crypto.randomUUID();
}

/**
 * Generate a random client ID (e.g., "CL-ABC123XYZ")
 */
export function generateClientId(): string {
	const randomPart = crypto.randomBytes(6).toString("hex").toUpperCase();
	return `CL-${randomPart}`;
}

/**
 * Generate encryption key for environment setup (one-time use)
 * This should be used only during initial setup
 */
export function generateEncryptionKey(): string {
	return crypto.randomBytes(32).toString("hex");
}

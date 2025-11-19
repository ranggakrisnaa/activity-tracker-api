import { Repository } from "typeorm";
import { AppDataSource } from "@/database/data-source";
import { Client } from "@/database/entities/client.entity";
import { generateClientId, generateAPIKey, hashAPIKey, encrypt } from "@/utils/crypto.utils";
import { withDatabaseRetry } from "@/utils/retry.utils";

export class ClientRepository {
	private repository: Repository<Client>;

	constructor() {
		this.repository = AppDataSource.getRepository(Client);
	}

	async create(data: { name: string; email: string; rateLimit?: number }): Promise<Client> {
		const clientId = generateClientId();
		const apiKey = generateAPIKey();
		const apiKeyHash = await hashAPIKey(apiKey);
		const encryptedApiKey = encrypt(apiKey);

		const client = this.repository.create({
			clientId,
			name: data.name,
			email: data.email,
			apiKey: encryptedApiKey,
			apiKeyHash,
			isActive: true,
			rateLimit: data.rateLimit || 1000,
			metadata: {},
		});

		const savedClient = await this.repository.save(client);

		// Return client with plain API key for one-time display
		return {
			...savedClient,
			apiKey,
		} as Client;
	}

	async findById(id: string): Promise<Client | null> {
		return await this.repository.findOne({ where: { id } });
	}

	async findByClientId(clientId: string): Promise<Client | null> {
		return await withDatabaseRetry(async () => {
			return await this.repository.findOne({ where: { clientId } });
		});
	}

	async findByEmail(email: string): Promise<Client | null> {
		return await withDatabaseRetry(async () => {
			return await this.repository.findOne({ where: { email } });
		});
	}

	async findByApiKeyHash(apiKeyHash: string): Promise<Client | null> {
		return await withDatabaseRetry(async () => {
			return await this.repository.findOne({ where: { apiKeyHash } });
		});
	}

	async findAllActive(): Promise<Client[]> {
		return await withDatabaseRetry(async () => {
			return await this.repository.find({
				where: { isActive: true },
				order: { createdAt: "DESC" },
			});
		});
	}

	async findAll(): Promise<Client[]> {
		return await this.repository.find({
			order: { createdAt: "DESC" },
		});
	}

	async update(id: string, data: Partial<Client>): Promise<Client | null> {
		await this.repository.update({ id }, data);
		return await this.findById(id);
	}

	async updateLastAccess(id: string): Promise<void> {
		await this.repository.update({ id }, { lastAccessAt: new Date() });
	}

	async deactivate(id: string): Promise<Client | null> {
		await this.repository.update({ id }, { isActive: false });
		return await this.findById(id);
	}

	async activate(id: string): Promise<Client | null> {
		await this.repository.update({ id }, { isActive: true });
		return await this.findById(id);
	}

	async delete(id: string): Promise<boolean> {
		const result = await this.repository.delete({ id });
		return (result.affected ?? 0) > 0;
	}

	async existsByEmail(email: string): Promise<boolean> {
		const count = await this.repository.count({ where: { email } });
		return count > 0;
	}
	async existsByClientId(clientId: string): Promise<boolean> {
		const count = await this.repository.count({ where: { clientId } });
		return count > 0;
	}

	async count(): Promise<number> {
		return await this.repository.count();
	}

	async countActive(): Promise<number> {
		return await this.repository.count({ where: { isActive: true } });
	}
}

// Export singleton instance
export const clientRepository = new ClientRepository();

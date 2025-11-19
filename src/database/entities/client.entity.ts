import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";

@Entity("clients")
@Index("idx_client_id", ["clientId"])
@Index("idx_api_key", ["apiKey"])
@Index("idx_email", ["email"])
export class Client {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column({ name: "client_id", type: "varchar", length: 100, unique: true, nullable: false })
	clientId: string;

	@Column({ type: "varchar", length: 255, nullable: false })
	name: string;

	@Column({ type: "varchar", length: 255, unique: true, nullable: false })
	email: string;

	@Column({ name: "api_key", type: "varchar", length: 500, nullable: false })
	apiKey: string;

	@Column({ name: "api_key_hash", type: "varchar", length: 500, nullable: true })
	apiKeyHash: string;

	@Column({ name: "is_active", type: "boolean", default: true })
	isActive: boolean;

	@Column({ name: "rate_limit", type: "int", default: 1000 })
	rateLimit: number;

	@Column({ type: "jsonb", nullable: true })
	metadata: Record<string, any>;

	@CreateDateColumn({ name: "created_at", type: "timestamp with time zone" })
	createdAt: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamp with time zone" })
	updatedAt: Date;

	@Column({ name: "last_access_at", type: "timestamp with time zone", nullable: true })
	lastAccessAt: Date;
}

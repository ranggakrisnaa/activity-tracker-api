import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

@Entity("api_logs")
@Index("idx_client_id_timestamp", ["clientId", "timestamp"])
@Index("idx_api_key_timestamp", ["apiKey", "timestamp"])
@Index("idx_timestamp", ["timestamp"])
@Index("idx_endpoint", ["endpoint"])
@Index("idx_status_code", ["statusCode"])
export class ApiLog {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column({ name: "client_id", type: "varchar", length: 100, nullable: false })
	clientId: string;

	@Column({ name: "api_key", type: "varchar", length: 100, nullable: false })
	apiKey: string; // Not encrypted, for quick lookup

	@Column({ type: "varchar", length: 500, nullable: false })
	endpoint: string;

	@Column({ type: "varchar", length: 10, nullable: false })
	method: string;

	@Column({ name: "status_code", type: "int", nullable: false })
	statusCode: number;

	@Column({ name: "response_time", type: "int", nullable: true })
	responseTime: number; // in milliseconds

	@Column({ name: "ip_address", type: "varchar", length: 100, nullable: true })
	ipAddress: string;

	@Column({ name: "user_agent", type: "varchar", length: 500, nullable: true })
	userAgent: string;

	@Column({ name: "request_headers", type: "jsonb", nullable: true })
	requestHeaders: Record<string, any>;

	@Column({ name: "request_body", type: "jsonb", nullable: true })
	requestBody: Record<string, any>;

	@Column({ name: "response_body", type: "jsonb", nullable: true })
	responseBody: Record<string, any>;

	@Column({ name: "error_message", type: "text", nullable: true })
	errorMessage: string;

	@Column({ type: "jsonb", nullable: true })
	metadata: Record<string, any>;

	@CreateDateColumn({ type: "timestamp with time zone" })
	timestamp: Date;

	// For partitioning by date (year-month)
	@Column({ name: "partition_key", type: "varchar", length: 7, nullable: false })
	partitionKey: string; // Format: YYYY-MM
}

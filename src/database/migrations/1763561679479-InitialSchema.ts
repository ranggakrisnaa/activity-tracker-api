import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1763561679479 implements MigrationInterface {
	name = "InitialSchema1763561679479";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TABLE "clients" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "client_id" character varying(100) NOT NULL, "name" character varying(255) NOT NULL, "email" character varying(255) NOT NULL, "api_key" character varying(500) NOT NULL, "api_key_hash" character varying(500), "is_active" boolean NOT NULL DEFAULT true, "rate_limit" integer NOT NULL DEFAULT '1000', "metadata" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_access_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_49e91f1e368e3f760789e7764aa" UNIQUE ("client_id"), CONSTRAINT "UQ_b48860677afe62cd96e12659482" UNIQUE ("email"), CONSTRAINT "PK_f1ab7cf3a5714dbc6bb4e1c28a4" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(`CREATE INDEX "idx_email" ON "clients" ("email") `);
		await queryRunner.query(`CREATE INDEX "idx_api_key" ON "clients" ("api_key") `);
		await queryRunner.query(`CREATE INDEX "idx_client_id" ON "clients" ("client_id") `);
		await queryRunner.query(
			`CREATE TABLE "api_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "client_id" character varying(100) NOT NULL, "api_key" character varying(100) NOT NULL, "endpoint" character varying(500) NOT NULL, "method" character varying(10) NOT NULL, "status_code" integer NOT NULL, "response_time" integer, "ip_address" character varying(100), "user_agent" character varying(500), "request_headers" jsonb, "request_body" jsonb, "response_body" jsonb, "error_message" text, "metadata" jsonb, "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "partition_key" character varying(7) NOT NULL, CONSTRAINT "PK_ea3f2ad34a2921407593ff4425b" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(`CREATE INDEX "idx_status_code" ON "api_logs" ("status_code") `);
		await queryRunner.query(`CREATE INDEX "idx_endpoint" ON "api_logs" ("endpoint") `);
		await queryRunner.query(`CREATE INDEX "idx_timestamp" ON "api_logs" ("timestamp") `);
		await queryRunner.query(`CREATE INDEX "idx_api_key_timestamp" ON "api_logs" ("api_key", "timestamp") `);
		await queryRunner.query(`CREATE INDEX "idx_client_id_timestamp" ON "api_logs" ("client_id", "timestamp") `);

		// Create function to automatically set partition_key
		await queryRunner.query(`
            CREATE OR REPLACE FUNCTION set_partition_key()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.partition_key = TO_CHAR(NEW.timestamp, 'YYYY-MM');
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);

		// Create trigger to call the function before insert
		await queryRunner.query(`
            CREATE TRIGGER set_partition_key_trigger
            BEFORE INSERT ON api_logs
            FOR EACH ROW
            EXECUTE FUNCTION set_partition_key();
        `);

		// Create index on partition_key for efficient querying
		await queryRunner.query(`CREATE INDEX "idx_partition_key" ON "api_logs" ("partition_key")`);
	}
	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "public"."idx_partition_key"`);
		await queryRunner.query(`DROP TRIGGER IF EXISTS set_partition_key_trigger ON api_logs`);
		await queryRunner.query(`DROP FUNCTION IF EXISTS set_partition_key`);
		await queryRunner.query(`DROP INDEX "public"."idx_client_id_timestamp"`);
		await queryRunner.query(`DROP INDEX "public"."idx_api_key_timestamp"`);
		await queryRunner.query(`DROP INDEX "public"."idx_timestamp"`);
		await queryRunner.query(`DROP INDEX "public"."idx_endpoint"`);
		await queryRunner.query(`DROP INDEX "public"."idx_status_code"`);
		await queryRunner.query(`DROP TABLE "api_logs"`);
		await queryRunner.query(`DROP INDEX "public"."idx_client_id"`);
		await queryRunner.query(`DROP INDEX "public"."idx_api_key"`);
		await queryRunner.query(`DROP INDEX "public"."idx_email"`);
		await queryRunner.query(`DROP TABLE "clients"`);
	}
}

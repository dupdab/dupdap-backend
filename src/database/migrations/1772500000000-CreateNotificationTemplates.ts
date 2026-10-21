import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationTemplates1772500000000 implements MigrationInterface {
  name = 'CreateNotificationTemplates1772500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notification_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "subject" character varying(255) NOT NULL, "html_body" text NOT NULL, "version" integer NOT NULL DEFAULT 1, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_notification_templates_name" UNIQUE ("name"), CONSTRAINT "PK_notification_templates" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "notification_template_versions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "template_id" uuid NOT NULL, "version" integer NOT NULL, "subject" character varying(255) NOT NULL, "html_body" text NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_notification_template_versions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_notification_template_versions_template_version" ON "notification_template_versions" ("template_id", "version")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_notification_template_versions_template_version"`);
    await queryRunner.query(`DROP TABLE "notification_template_versions"`);
    await queryRunner.query(`DROP TABLE "notification_templates"`);
  }
}

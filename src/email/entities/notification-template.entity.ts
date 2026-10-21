import { Entity, Column, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

/**
 * Editable email template. `name` is the template alias used by
 * `EmailService.queue(...)`; when a row exists for an alias it overrides the
 * file-based template in `src/email/templates`.
 */
@Entity('notification_templates')
export class NotificationTemplate extends BaseEntity {
  @Column({ type: 'varchar', length: 100, unique: true })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  subject!: string;

  @Column({ name: 'html_body', type: 'text' })
  htmlBody!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;
}

/**
 * Immutable snapshot of a template as it was before an edit or rollback.
 * Rows are append-only; the live template always lives on `NotificationTemplate`.
 */
@Entity('notification_template_versions')
@Index(['templateId', 'version'], { unique: true })
export class NotificationTemplateVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'template_id' })
  templateId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'varchar', length: 255 })
  subject!: string;

  @Column({ name: 'html_body', type: 'text' })
  htmlBody!: string;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'now()' })
  createdAt!: Date;
}

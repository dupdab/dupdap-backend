import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import * as Handlebars from 'handlebars';
import {
  NotificationTemplate,
  NotificationTemplateVersion,
} from './entities/notification-template.entity';
import {
  CreateNotificationTemplateDto,
  UpdateNotificationTemplateDto,
} from './dto/notification-template.dto';

@Injectable()
export class NotificationTemplateService {
  constructor(
    @InjectRepository(NotificationTemplate)
    private readonly templateRepo: Repository<NotificationTemplate>,
    @InjectRepository(NotificationTemplateVersion)
    private readonly versionRepo: Repository<NotificationTemplateVersion>,
  ) {}

  list(): Promise<NotificationTemplate[]> {
    return this.templateRepo.find({ order: { name: 'ASC' } });
  }

  async get(id: string): Promise<NotificationTemplate> {
    const template = await this.templateRepo.findOne({ where: { id } });
    if (!template) throw new NotFoundException(`Notification template ${id} not found`);
    return template;
  }

  findByName(name: string): Promise<NotificationTemplate | null> {
    return this.templateRepo.findOne({ where: { name } });
  }

  async create(dto: CreateNotificationTemplateDto): Promise<NotificationTemplate> {
    this.assertCompiles(dto.subject, dto.htmlBody);
    if (await this.findByName(dto.name)) {
      throw new ConflictException(`Notification template "${dto.name}" already exists`);
    }
    return this.templateRepo.save(this.templateRepo.create({ ...dto, version: 1 }));
  }

  /**
   * Saves the current content as a version snapshot, then applies the edit
   * and bumps `version`. Runs in a transaction with a row lock so concurrent
   * edits cannot reuse the same version number.
   */
  async update(id: string, dto: UpdateNotificationTemplateDto): Promise<NotificationTemplate> {
    this.assertCompiles(dto.subject ?? '', dto.htmlBody ?? '');
    return this.templateRepo.manager.transaction(async (em) => {
      const template = await this.lockOrThrow(em, id);
      await this.snapshot(em, template);
      Object.assign(template, dto, { version: template.version + 1 });
      return em.save(template);
    });
  }

  async listVersions(id: string): Promise<NotificationTemplateVersion[]> {
    await this.get(id);
    return this.versionRepo.find({ where: { templateId: id }, order: { version: 'DESC' } });
  }

  /**
   * Restores the content of an older version. The current content is snapshot
   * first and the restored content gets a new version number, so history is
   * never rewritten.
   */
  async rollback(id: string, version: number): Promise<NotificationTemplate> {
    return this.templateRepo.manager.transaction(async (em) => {
      const template = await this.lockOrThrow(em, id);
      const target = await em.getRepository(NotificationTemplateVersion).findOne({
        where: { templateId: id, version },
      });
      if (!target) {
        throw new NotFoundException(`Version ${version} of template ${id} not found`);
      }
      await this.snapshot(em, template);
      Object.assign(template, {
        subject: target.subject,
        htmlBody: target.htmlBody,
        version: template.version + 1,
      });
      return em.save(template);
    });
  }

  async preview(
    id: string,
    testData: Record<string, unknown> = {},
  ): Promise<{ subject: string; html: string }> {
    const template = await this.get(id);
    return {
      subject: Handlebars.compile(template.subject)(testData),
      html: Handlebars.compile(template.htmlBody)(testData),
    };
  }

  private async lockOrThrow(em: EntityManager, id: string): Promise<NotificationTemplate> {
    const template = await em.getRepository(NotificationTemplate).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!template) throw new NotFoundException(`Notification template ${id} not found`);
    return template;
  }

  private snapshot(em: EntityManager, template: NotificationTemplate): Promise<NotificationTemplateVersion> {
    return em.getRepository(NotificationTemplateVersion).save({
      templateId: template.id,
      version: template.version,
      subject: template.subject,
      htmlBody: template.htmlBody,
    });
  }

  private assertCompiles(subject: string, htmlBody: string): void {
    try {
      Handlebars.precompile(subject);
      Handlebars.precompile(htmlBody);
    } catch (err) {
      throw new BadRequestException(`Invalid Handlebars template: ${(err as Error).message}`);
    }
  }
}

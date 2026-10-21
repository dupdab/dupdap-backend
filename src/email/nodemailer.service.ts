import { Injectable, Logger, Inject, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import { emailConfig } from '../config/email.config';
import { NotificationTemplateService } from './notification-template.service';

export interface MailSendResult {
  messageId: string;
}

// Resolves to src/email/templates in dev (ts-node) and dist/email/templates after build.
// nest-cli.json must include "assets": [{"include": "email/templates/**", "outDir": "dist"}]
const TEMPLATES_DIR = path.join(__dirname, 'templates');

const SUBJECTS: Record<string, string> = {
  welcome: 'Welcome to DupDub',
  'payment-confirmed': 'Payment Confirmed',
  'settlement-completed': 'Settlement Completed',
  'payment-failed': 'Payment Failed',
  'analytics-report-ready': 'Your Analytics Report Is Ready',
};

@Injectable()
export class NodemailerService implements OnModuleInit {
  private readonly logger = new Logger(NodemailerService.name);
  private transporter!: nodemailer.Transporter;
  private layout!: Handlebars.TemplateDelegate;

  constructor(
    @Inject(emailConfig.KEY)
    private readonly cfg: ConfigType<typeof emailConfig>,
    // Optional so the mailer still resolves where the template table is not wired.
    @Optional()
    private readonly notificationTemplates?: NotificationTemplateService,
  ) {}

  onModuleInit(): void {
    this.transporter = nodemailer.createTransport({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.secure,
      auth: { user: this.cfg.user, pass: this.cfg.pass },
    });

    const layoutSrc = fs.readFileSync(
      path.join(TEMPLATES_DIR, 'layout.hbs'),
      'utf8',
    );
    this.layout = Handlebars.compile(layoutSrc);
  }

  async send(
    to: string,
    templateAlias: string,
    mergeData: Record<string, unknown>,
  ): Promise<MailSendResult> {
    const { subject, html, text } = await this.renderTemplates(templateAlias, mergeData);

    const info = await this.transporter.sendMail({
      from: `"${this.cfg.fromName}" <${this.cfg.from}>`,
      to,
      subject,
      html,
      text,
    });

    this.logger.log(`Email sent to=${to} template=${templateAlias} messageId=${info.messageId}`);
    return { messageId: info.messageId as string };
  }

  /**
   * A stored NotificationTemplate with the same name overrides the file-based
   * subject and HTML body. The plain-text body still comes from the file when
   * one exists, and is omitted for stored-only templates.
   */
  private async renderTemplates(
    templateAlias: string,
    mergeData: Record<string, unknown>,
  ): Promise<{ subject: string; html: string; text?: string }> {
    const vars = { ...mergeData, year: new Date().getFullYear() };
    const stored = await this.notificationTemplates?.findByName(templateAlias);

    const htmlBodySrc = stored ? stored.htmlBody : this.readTemplate(`${templateAlias}.html.hbs`);
    const htmlBody = Handlebars.compile(htmlBodySrc)(vars);

    const storedSubject = stored ? Handlebars.compile(stored.subject)(vars) : undefined;
    const subject =
      (mergeData['subject'] as string | undefined) ?? storedSubject ?? SUBJECTS[templateAlias] ?? templateAlias;
    const html = this.layout({ ...vars, body: htmlBody, subject });

    const textPath = path.join(TEMPLATES_DIR, `${templateAlias}.text.hbs`);
    const text = stored && !fs.existsSync(textPath)
      ? undefined
      : Handlebars.compile(this.readTemplate(`${templateAlias}.text.hbs`))(vars);

    return { subject, html, text };
  }

  private readTemplate(filename: string): string {
    const filePath = path.join(TEMPLATES_DIR, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Email template not found: ${filename}`);
    }
    return fs.readFileSync(filePath, 'utf8');
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { mkdir, stat, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import { AdminAlert, AdminAlertType } from '../admin/entities/admin-alert.entity';

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    @InjectRepository(AdminAlert)
    private readonly adminAlertRepository: Repository<AdminAlert>,
  ) {}

  async runBackup(): Promise<string> {
    const backupDir = process.env.BACKUP_DIR || join(process.cwd(), 'backups');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = join(backupDir, `backup-${timestamp}.sql`);

    await mkdir(dirname(filePath), { recursive: true });

    const exitCode = await this.dumpDatabase(filePath);

    if (exitCode !== 0) {
      this.logger.error(`pg_dump failed with exit code ${exitCode}`);
      await this.raiseBackupFailureAlert(exitCode);
      await this.cleanupPartialFile(filePath);
      throw new Error(`pg_dump failed with exit code ${exitCode}`);
    }

    const { size } = await stat(filePath);
    this.logger.log(`Backup completed: ${filePath} (${size} bytes)`);
    return filePath;
  }

  private dumpDatabase(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const output = createWriteStream(filePath);
      const child = spawn('pg_dump', [
        '--no-owner',
        '--no-privileges',
        '--format=plain',
        process.env.DATABASE_URL || '',
      ]);

      child.stdout.pipe(output);

      child.stderr.on('data', (data: Buffer) => {
        this.logger.warn(`pg_dump: ${data.toString().trim()}`);
      });

      child.on('error', (err) => {
        output.end();
        reject(err);
      });

      child.on('close', (code) => {
        output.end();
        resolve(code ?? 1);
      });
    });
  }

  private async raiseBackupFailureAlert(exitCode: number): Promise<void> {
    try {
      const alreadyRaised = await this.hasAlertToday(AdminAlertType.BACKUP_FAILURE);
      if (alreadyRaised) {
        this.logger.warn('BACKUP_FAILURE alert already raised today; skipping duplicate');
        return;
      }

      const alert = this.adminAlertRepository.create({
        type: AdminAlertType.BACKUP_FAILURE,
        message: `Database backup failed: pg_dump exited with code ${exitCode}`,
      });
      await this.adminAlertRepository.save(alert);
    } catch (err) {
      this.logger.error(`Failed to raise BACKUP_FAILURE alert: ${(err as Error).message}`);
    }
  }

  private async hasAlertToday(type: AdminAlertType): Promise<boolean> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const count = await this.adminAlertRepository
      .createQueryBuilder('alert')
      .where('alert.type = :type', { type })
      .andWhere('alert.createdAt >= :startOfDay', { startOfDay })
      .getCount();

    return count > 0;
  }

  private async cleanupPartialFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // ignore cleanup errors
    }
  }
}

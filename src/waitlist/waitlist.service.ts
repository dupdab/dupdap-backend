import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { WaitlistEntry } from './entities/waitlist.entity';
import { JoinWaitlistDto } from './dto/join-waitlist.dto';
import { Merchant, MerchantStatus } from '../merchants/entities/merchant.entity';
import { EmailService } from '../email/email.service';
import { WaitlistQueryDto, WaitlistNotifyDto } from './dto/admin-waitlist.dto';

export { JoinWaitlistDto } from './dto/join-waitlist.dto';

@Injectable()
export class WaitlistService {
  constructor(
    @InjectRepository(WaitlistEntry)
    private waitlistRepo: Repository<WaitlistEntry>,
    @InjectRepository(Merchant)
    private merchantsRepo: Repository<Merchant>,
    private emailService: EmailService,
  ) {}

  async join(dto: JoinWaitlistDto) {
    const existing = await this.waitlistRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already on waitlist');

    const entry = this.waitlistRepo.create(dto);
    return this.waitlistRepo.save(entry);
  }

  async checkUsername(username: string): Promise<{ available: boolean }> {
    const existing = await this.waitlistRepo.findOne({ where: { username } });
    return { available: !existing };
  }

  async getStats() {
    const total = await this.waitlistRepo.count();
    return { total };
  }

  async list(query: WaitlistQueryDto) {
    const where: any = {};
    if (query.country) where.country = query.country;
    if (query.from || query.to) where.createdAt = Between(query.from ? new Date(query.from) : new Date(0), query.to ? new Date(query.to) : new Date());
    const page = query.page ?? 1, limit = query.limit ?? 20;
    const qb = this.waitlistRepo.createQueryBuilder('entry').where(where);
    if (query.search) qb.andWhere('(entry.email ILIKE :search OR entry."businessName" ILIKE :search)', { search: `%${query.search}%` });
    if (query.minReferrals != null) qb.andWhere('entry."referralCount" >= :minReferrals', { minReferrals: query.minReferrals });
    qb.orderBy(`entry.${query.sortBy ?? 'createdAt'}`, query.order ?? 'DESC').skip((page - 1) * limit).take(limit);
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }

  async approve(id: string) {
    const entry = await this.waitlistRepo.findOne(id);
    if (!entry) throw new NotFoundException('Waitlist entry not found');
    let merchant = await this.merchantsRepo.findOne({ where: { email: entry.email } });
    const password = randomBytes(12).toString('base64url');
    if (!merchant) merchant = await this.merchantsRepo.save(this.merchantsRepo.create({
      email: entry.email, businessName: entry.businessName || entry.email, country: entry.country,
      passwordHash: await bcrypt.hash(password, 12), status: MerchantStatus.ACTIVE,
    }));
    entry.approved = true;
    await this.waitlistRepo.save(entry);
    await this.emailService.queue(entry.email, 'waitlist-approved', { email: entry.email, password, merchantName: entry.businessName || entry.email }, merchant.id);
    return merchant;
  }

  async notify(dto: WaitlistNotifyDto, preview = false) {
    const where: any = { unsubscribed: false };
    if (dto.target === 'filter' && dto.country) where.country = dto.country;
    const recipients = await this.waitlistRepo.find({ where });
    if (preview) return { recipients: recipients.map(({ email }) => email), total: recipients.length };
    const logs = await Promise.all(recipients.map((entry) => this.emailService.queue(entry.email, 'waitlist-campaign', { subject: dto.subject, body: dto.body }, entry.id)));
    return { total: recipients.length, queued: logs.length, skipped: await this.waitlistRepo.count({ where: { unsubscribed: true } }) };
  }
}

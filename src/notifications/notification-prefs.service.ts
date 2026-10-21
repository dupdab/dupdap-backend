import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Merchant } from '../merchants/entities/merchant.entity';
import {
  NotificationChannel,
  NotificationEventType,
  NotificationPreference,
} from './entities/notification-preference.entity';
import {
  NotificationPrefResponseItemDto,
  NotificationPrefsResponseDto,
  UpdateNotificationPrefsDto,
} from './dto/notification-prefs.dto';

/** All valid channel × event combinations, used to seed defaults. */
const ALL_CHANNELS = Object.values(NotificationChannel);
const ALL_EVENTS = Object.values(NotificationEventType);

/** SMS costs money per message, so it is opt-in; every other channel is on by default. */
const defaultEnabled = (channel: NotificationChannel): boolean =>
  channel !== NotificationChannel.SMS;

@Injectable()
export class NotificationPrefsService {
  constructor(
    @InjectRepository(NotificationPreference)
    private readonly prefsRepo: Repository<NotificationPreference>,
    @InjectRepository(Merchant)
    private readonly merchantRepo: Repository<Merchant>,
  ) {}

  async getPrefs(merchantId: string): Promise<NotificationPrefsResponseDto> {
    const [stored, merchant] = await Promise.all([
      this.prefsRepo.find({ where: { merchantId } }),
      this.merchantRepo.findOne({ where: { id: merchantId }, select: ['id', 'smsPhoneNumber'] }),
    ]);

    // Build a full matrix, filling in defaults for any missing rows
    const preferences: NotificationPrefResponseItemDto[] = [];

    for (const channel of ALL_CHANNELS) {
      for (const eventType of ALL_EVENTS) {
        const existing = stored.find(
          (p) => p.channel === channel && p.eventType === eventType,
        );

        const isInApp = channel === NotificationChannel.IN_APP;

        preferences.push({
          channel,
          eventType,
          // in_app is always enabled; unsaved rows fall back to the channel default
          enabled: isInApp ? true : (existing?.enabled ?? defaultEnabled(channel)),
          ...(isInApp ? { readonly: true } : {}),
        });
      }
    }

    return { preferences, phoneNumber: merchant?.smsPhoneNumber ?? null };
  }

  async updatePrefs(
    merchantId: string,
    dto: UpdateNotificationPrefsDto,
  ): Promise<NotificationPrefsResponseDto> {
    for (const item of dto.preferences) {
      if (item.channel === NotificationChannel.IN_APP && !item.enabled) {
        throw new BadRequestException(
          'in_app notifications cannot be disabled',
        );
      }
    }

    // Validate before writing anything so a rejected request leaves no partial state
    const enablesSms = dto.preferences.some(
      (item) => item.channel === NotificationChannel.SMS && item.enabled,
    );
    if (enablesSms) {
      const phoneNumber =
        dto.phoneNumber ??
        (await this.merchantRepo.findOne({ where: { id: merchantId }, select: ['id', 'smsPhoneNumber'] }))
          ?.smsPhoneNumber;
      if (!phoneNumber) {
        throw new BadRequestException(
          'A phoneNumber is required before enabling sms notifications',
        );
      }
    }

    if (dto.phoneNumber !== undefined) {
      await this.merchantRepo.update(merchantId, { smsPhoneNumber: dto.phoneNumber });
    }

    // Upsert each preference using the unique constraint (merchantId, channel, eventType)
    for (const item of dto.preferences) {
      const isInApp = item.channel === NotificationChannel.IN_APP;
      const enabled = isInApp ? true : item.enabled;

      await this.prefsRepo
        .createQueryBuilder()
        .insert()
        .into(NotificationPreference)
        .values({
          merchantId,
          channel: item.channel,
          eventType: item.eventType,
          enabled,
        })
        .orUpdate(['enabled', 'updatedAt'], ['merchant_id', 'channel', 'eventType'])
        .execute();
    }

    return this.getPrefs(merchantId);
  }

  /**
   * Utility used by other services to check whether a specific channel+event
   * is enabled for a merchant before dispatching a notification.
   */
  async isEnabled(
    merchantId: string,
    channel: NotificationChannel,
    eventType: NotificationEventType,
  ): Promise<boolean> {
    if (channel === NotificationChannel.IN_APP) return true;

    const pref = await this.prefsRepo.findOne({
      where: { merchantId, channel, eventType },
    });

    // Fall back to the channel default if no preference row exists yet
    return pref?.enabled ?? defaultEnabled(channel);
  }
}

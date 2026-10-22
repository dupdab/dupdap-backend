import { Injectable } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { Merchant } from '../merchants/entities/merchant.entity';
import { NotificationPrefsService } from './notification-prefs.service';

/** Creates default notification preferences whenever a merchant is registered. */
@Injectable()
export class MerchantNotificationDefaultsSubscriber implements EntitySubscriberInterface<Merchant> {
  constructor(
    dataSource: DataSource,
    private readonly prefs: NotificationPrefsService,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo() {
    return Merchant;
  }

  async afterInsert(event: InsertEvent<Merchant>): Promise<void> {
    if (event.entity?.id) {
      await this.prefs.createDefaults(event.entity.id, event.manager);
    }
  }
}

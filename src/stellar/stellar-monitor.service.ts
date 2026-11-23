import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import Big from 'big.js';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { QUEUE_NAMES } from '../queues/queue.constants';
import { DataSource, Repository } from 'typeorm';
import { Gauge } from 'prom-client';
import { CacheService } from '../cache/cache.service';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { AdminAlertType } from '../alerts/admin-alert.entity';
import { Payment, PaymentStatus } from '../payments/entities/payment.entity';
import { StellarService } from './stellar.service';
import { SorobanMonitorService } from './soroban-monitor.service';
import { SettlementsService } from '../settlements/settlements.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { Merchant } from '../merchants/entities/merchant.entity';
import { NotificationPrefsService } from '../notifications/notification-prefs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationChannel, NotificationEventType } from '../notifications/entities/notification-preference.entity';
import { RetryConfigService } from '../retry/retry-config.service';
import { Gauge } from 'prom-client';

/** Unix timestamp (seconds) of the last Stellar transaction processed by the monitor. */
export const stellarMonitorLastProcessedAt = new Gauge({
  name: 'stellar_monitor_last_processed_at',
  help: 'Unix timestamp (seconds) of the last Stellar transaction processed by the monitor',
});

const DEFAULT_STALE_AFTER_MS = 600_000;

const CURSOR_KEY_PREFIX = 'stellar:monitor:horizon-cursor:';
const CURSOR_TTL_SECONDS = 60 * 60 * 24 * 365;

/** Last Horizon ledger sequence processed by the Stellar monitor. */
export const stellarMonitorLastProcessedLedger = new Gauge({
  name: 'stellar_monitor_last_processed_ledger',
  help: 'Ledger sequence of the last Horizon transaction processed by the Stellar monitor',
});

@Injectable()
export class StellarMonitorService implements OnModuleInit {
  private readonly logger = new Logger(StellarMonitorService.name);
  private cursors: Map<string, string> = new Map();
  private lastRunAt: Date | null = null;
  private lastRunStatus: 'idle' | 'ok' | 'error' = 'idle';
  private lastRunError: string | null = null;
  private lastProcessedLedger: number | null = null;
  private lastProcessedAt: Date | null = null;
  private readonly startedAt = new Date();
  private lagLedgers = 0;

  constructor(
    @InjectRepository(Payment)
    private paymentsRepo: Repository<Payment>,
    @InjectDataSource()
    private dataSource: DataSource,
    private adminAlerts: AdminAlertService,
    private stellar: StellarService,
    private settlements: SettlementsService,
    private webhooks: WebhooksService,
    private emailService: EmailService,
    private config: ConfigService,
    private notificationPrefs: NotificationPrefsService,
    private notifications: NotificationsService,
    private sorobanMonitor: SorobanMonitorService,
    @InjectQueue(QUEUE_NAMES.stellarMonitor) private monitorQueue: Queue,
    private retryConfig: RetryConfigService,
    @Optional() private cache?: CacheService,
  ) {}

  async onModuleInit(): Promise<void> {
    const monitorRetry = this.retryConfig.stellarMonitor;
    await this.monitorQueue.add(
      'scan',
      {},
      {
        repeat: { every: 30_000 },
        jobId: 'stellar-monitor-repeat',
        removeOnComplete: true,
        attempts: monitorRetry.maxAttempts + 1,
        backoff: { type: 'fixed', delay: monitorRetry.delaysMs[0] ?? 0 },
      },
    );
    this.logger.log('Stellar monitor Bull job scheduled every 30 seconds');
  }

  async scanPendingPayments() {
    await this.checkStaleness();

    // Graceful degradation: while the Horizon circuit is open, pause polling
    // instead of issuing requests that are known to fail.
    if (this.stellar.isHorizonCircuitOpen()) {
      this.logger.warn('Horizon circuit is open; skipping Stellar poll until it recovers');
      return;
    }

    try {
      const depositAddress = this.stellar.getDepositAddress();
      if (!depositAddress) {
        this.markRunSuccess();
        return;
      }

      if (!this.cursors.has(depositAddress)) await this.loadCursor(depositAddress);
      const cursor = this.cursors.get(depositAddress);
      this.logger.log(
        `Stellar monitor poll start | address: ${depositAddress} | cursor: ${cursor ?? 'none'}`,
      );

      let transactions: any[];

      try {
        transactions = await this.stellar.getAccountTransactions(depositAddress, cursor);
      } catch (err) {
        this.logger.error('Failed to fetch Stellar transactions', err.message);
        await this.adminAlerts.raise({
          type: AdminAlertType.STELLAR_MONITOR,
          dedupeKey: 'stellar-monitor.fetch',
          message: `Failed to fetch Stellar transactions: ${err.message}`,
          metadata: { depositAddress },
          thresholdValue: 1,
        });
        this.markRunFailure(err);
        return;
      }

      for (const tx of transactions) {
        this.cursors.set(depositAddress, tx.paging_token);
        this.lastProcessedAt = new Date();
        stellarMonitorLastProcessedAt.set(this.lastProcessedAt.getTime() / 1000);

        const txLedger = this.parseLedger(tx);
        if (txLedger !== null) {
          this.lastProcessedLedger = txLedger;
          stellarMonitorLastProcessedLedger.set(txLedger);
        }

        const paymentMemo = tx.memo;
        if (!paymentMemo) continue;

        // Query directly by memo+status so monitoring can use the memo index.
        const matched = await this.paymentsRepo.findOne({
          where: {
            status: PaymentStatus.PENDING,
            stellarMemo: paymentMemo,
          },
          relations: ['merchant'],
        });
        if (!matched) continue;

        const result = await this.stellar.verifyPayment(tx.hash, paymentMemo);
        if (!result.verified) continue;

        this.logger.log(
          `Stellar payment detected | memo: ${paymentMemo} | amount: ${result.amount} ${result.asset} | tx: ${tx.hash} | reference: ${matched.reference}`,
        );

        try {
          await this.confirmPayment(matched, tx.hash, result.amount, result.asset, result.from);
        } catch (err) {
          await this.adminAlerts.raise({
            type: AdminAlertType.STELLAR_MONITOR,
            dedupeKey: `stellar-monitor.confirm:${matched.id}`,
            message: `Failed to confirm payment ${matched.reference}: ${err.message}`,
            metadata: { txHash: tx.hash, paymentId: matched.id },
            thresholdValue: 1,
          });
        }
      }

      // Persist only after the batch succeeds, so a mid-batch failure replays
      // transactions on restart (safe: matching requires PENDING status).
      if (transactions.length > 0) {
        await this.persistCursor(depositAddress, this.cursors.get(depositAddress));
      }

      await this.expireOldPayments();

      // Soroban escrow monitor: poll contract state-transition events
      await this.sorobanMonitor.pollEscrowEvents();

      await this.updateLag(depositAddress);

      this.logger.log(
        `Stellar monitor poll end | address: ${depositAddress} | cursor: ${this.cursors.get(depositAddress) ?? 'none'} | transactions: ${transactions.length} | lag: ${this.lagLedgers} ledgers`,
      );

      this.markRunSuccess();
    } catch (error) {
      this.markRunFailure(error);
      throw error;
    }
  }

  getLastRunStatus(): {
    lastRunAt: string | null;
    status: 'idle' | 'ok' | 'error';
    lastError: string | null;
  } {
    return {
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      status: this.lastRunStatus,
      lastError: this.lastRunError,
    };
  }

  /**
   * Current polling lag in ledgers (current ledger minus last processed ledger).
   * Exposed as the `stellar_monitor_lag_ledgers` gauge.
   */
  getLagLedgers(): number {
    return this.lagLedgers;
  }

  /**
   * Raises an admin alert when no transaction has been processed for longer than
   * STELLAR_MONITOR_STALE_AFTER_MS (default 10 minutes). The clock starts at boot,
   * so a monitor that never processes anything still alerts.
   */
  private async checkStaleness(): Promise<void> {
    const staleAfterMs = this.config.get<number>(
      'STELLAR_MONITOR_STALE_AFTER_MS',
      DEFAULT_STALE_AFTER_MS,
    );
    const idleMs = Date.now() - (this.lastProcessedAt ?? this.startedAt).getTime();
    if (idleMs <= staleAfterMs) return;

    const idleMinutes = Math.floor(idleMs / 60_000);
    this.logger.warn(`Stellar monitor has not processed a transaction for ${idleMinutes} minutes`);
    try {
      await this.adminAlerts.raise({
        type: AdminAlertType.STELLAR_MONITOR,
        dedupeKey: 'stellar-monitor.stale',
        message: `Stellar monitor has not processed a transaction for ${idleMinutes} minutes`,
        metadata: { lastProcessedAt: this.lastProcessedAt?.toISOString() ?? null },
        thresholdValue: 1,
      });
    } catch (err) {
      this.logger.error(`Failed to raise Stellar monitor staleness alert: ${err.message}`);
    }
  }

  private async updateLag(depositAddress: string): Promise<void> {
    try {
      const currentLedger = await this.stellar.getCurrentLedger();
      if (currentLedger === null || currentLedger === undefined) return;

      const lastProcessed = this.lastProcessedLedger ?? currentLedger;
      this.lagLedgers = Math.max(0, currentLedger - lastProcessed);

      this.logger.log(
        `Stellar monitor lag | current ledger: ${currentLedger} | last processed: ${lastProcessed} | lag: ${this.lagLedgers} ledgers | address: ${depositAddress}`,
      );
    } catch (err) {
      this.logger.warn(`Failed to compute Stellar monitor lag: ${err.message}`);
    }
  }

  /** Restore the Horizon paging cursor from Redis so restarts resume where they left off. */
  private async loadCursor(depositAddress: string): Promise<void> {
    if (!this.cache) return;
    try {
      const cursor = await this.cache.get<string>(CURSOR_KEY_PREFIX + depositAddress);
      if (cursor) this.cursors.set(depositAddress, cursor);
    } catch (err) {
      this.logger.warn(`Failed to load Stellar monitor cursor: ${err.message}`);
    }
  }

  private async persistCursor(depositAddress: string, cursor?: string): Promise<void> {
    if (!this.cache || !cursor) return;
    try {
      await this.cache.set(CURSOR_KEY_PREFIX + depositAddress, cursor, {
        ttlSeconds: CURSOR_TTL_SECONDS,
      });
    } catch (err) {
      this.logger.warn(`Failed to persist Stellar monitor cursor: ${err.message}`);
    }
  }

  private parseLedger(tx: any): number | null {
    const raw = tx?.ledger ?? tx?.ledger_attr ?? tx?.ledgerAttr;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async confirmPayment(
    payment: Payment,
    txHash: string,
    amount: number,
    asset: string,
    from?: string,
  ) {
    let contractRejected = false;
    const confirmed = await this.dataSource.transaction(async (manager) => {
      // Re-fetch with a row-level lock to prevent concurrent double-settlement.
      // If another worker already confirmed this payment, its status will no
      // longer be PENDING and we bail out safely.
      const locked = await manager.findOne(Payment, {
        where: { id: payment.id, status: PaymentStatus.PENDING },
        lock: { mode: 'pessimistic_write' },
      });

      if (!locked) {
        this.logger.warn(
          `confirmPayment: payment ${payment.reference} is no longer PENDING — skipping (possible concurrent confirm)`,
        );
        return null;
      }

      try {
        await this.stellar.invokeContract('confirm', [
          locked.id,
          txHash,
          amount,
          asset,
          from ?? null,
        ]);
      } catch (err) {
        // Persist FAILED in this transaction; otherwise the rollback leaves the payment PENDING forever
        this.logger.error(
          `Soroban confirm failed for payment ${locked.reference} | tx: ${txHash} | ${(err as Error).message}`,
        );
        locked.status = PaymentStatus.FAILED;
        locked.txHash = txHash;
        await manager.save(locked);
        contractRejected = true;
        return;
      }

      this.logger.log(`Payment confirmed: ${locked.reference} | tx: ${txHash}`);

      locked.status = PaymentStatus.CONFIRMED;
      locked.txHash = txHash;
      locked.confirmedAt = new Date();
      locked.customerWalletAddress = from;

      if (asset === 'USDC') locked.amountUsdc = amount;
      else locked.amountXlm = amount;

      await manager.save(locked);
      await this.settlements.initiateSettlement(locked, manager);

      return locked;
    });

    if (!confirmed) return;

    // Side-effects run only after the transaction has committed, so a rollback
    // can never leave a webhook or notification for a payment that did not persist.
    await this.queuePaymentConfirmedEmail(confirmed, asset);
    await this.queuePaymentConfirmedSms(confirmed);

    await this.webhooks.dispatch(confirmed.merchantId, 'payment.confirmed', {
      paymentId: confirmed.id,
      reference: confirmed.reference,
      txHash,
      amount,
      asset,
    });

    if (contractRejected) {
      await this.notifyPaymentFailed(payment, txHash);
    }
  }

  private async notifyPaymentFailed(
    payment: Payment & { merchant?: Merchant },
    txHash: string,
  ): Promise<void> {
    // Runs after commit: a delivery failure must not turn into a false "confirm failed" alert
    try {
      await this.webhooks.dispatch(payment.merchantId, 'payment.failed', {
        paymentId: payment.id,
        reference: payment.reference,
        txHash,
      });
      await this.queuePaymentFailedEmail(payment);
    } catch (err) {
      this.logger.error(
        `Failed to notify merchant of failed payment ${payment.reference}: ${(err as Error).message}`,
      );
    }
  }

  private async queuePaymentFailedEmail(payment: Payment & { merchant?: Merchant }): Promise<void> {
    const merchant = payment.merchant;
    if (!merchant?.email) return;

    const emailEnabled = await this.notificationPrefs.isEnabled(
      merchant.id,
      NotificationChannel.EMAIL,
      NotificationEventType.PAYMENT_FAILED,
    );
    if (!emailEnabled) return;

    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    await this.emailService.queue(merchant.email, 'payment-failed', {
      merchantName: merchant.businessName,
      reference: payment.reference,
      amount: Number(payment.amountUsd ?? 0).toFixed(2),
      currency: 'USD',
      reason: 'The on-chain payment could not be confirmed',
      failedAt: new Date().toISOString(),
      supportUrl: frontendUrl.replace(/\/$/, ''),
    });
  }

  private async queuePaymentConfirmedEmail(
    payment: Payment & { merchant?: Merchant },
    asset: string,
  ): Promise<void> {
    const merchant = payment.merchant;
    if (!merchant?.email) return;

    const emailEnabled = await this.notificationPrefs.isEnabled(
      merchant.id,
      NotificationChannel.EMAIL,
      NotificationEventType.PAYMENT_CONFIRMED,
    );
    if (!emailEnabled) return;

    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const paymentDetailUrl = `${frontendUrl.replace(/\/$/, '')}/pay/${payment.reference}`;
    const txUrl = this.buildExplorerUrl(payment.txHash);
    const assetAmount =
      asset === 'USDC'
        ? Number(payment.amountUsdc ?? 0).toFixed(6)
        : Number(payment.amountXlm ?? 0).toFixed(7);

    await this.emailService.queue(
      merchant.email,
      'payment-confirmed',
      {
        merchantName: merchant.businessName,
        reference: payment.reference,
        amountUsd: Number(payment.amountUsd ?? 0).toFixed(2),
        assetAmount,
        asset,
        txHash: payment.txHash,
        confirmedAt: new Date().toISOString(),
        txUrl,
        paymentDetailUrl,
      },
    );
  }

  private async queuePaymentConfirmedSms(
    payment: Payment & { merchant?: Merchant },
  ): Promise<void> {
    const merchant = payment.merchant;
    if (!merchant?.smsPhoneNumber) return;

    const smsEnabled = await this.notificationPrefs.isEnabled(
      merchant.id,
      NotificationChannel.SMS,
      NotificationEventType.PAYMENT_CONFIRMED,
    );
    if (!smsEnabled) return;

    await this.notifications.enqueueSms({
      to: merchant.smsPhoneNumber,
      body: `DupDub: payment ${payment.reference} confirmed for $${new Big(payment.amountUsd).toFixed(2)} USD.`,
    });
  }

  private buildExplorerUrl(txHash?: string): string {
    const network = this.config.get<string>('STELLAR_NETWORK', 'TESTNET');
    const networkPath = network === 'PUBLIC' ? 'public' : 'testnet';
    return txHash
      ? `https://stellar.expert/explorer/${networkPath}/tx/${txHash}`
      : '';
  }

  private async expireOldPayments() {
    const now = new Date();
    const expired = await this.paymentsRepo
      .createQueryBuilder('payment')
      .where('payment.status = :status', { status: PaymentStatus.PENDING })
      .andWhere('payment.expiresAt < :now', { now })
      .getMany();

    for (const payment of expired) {
      try {
        await this.stellar.invokeContract('expire', [payment.id]);
        payment.status = PaymentStatus.EXPIRED;
        await this.paymentsRepo.save(payment);

        await this.webhooks.dispatch(payment.merchantId, 'payment.expired', {
          paymentId: payment.id,
          reference: payment.reference,
        });
      } catch (err) {
        this.logger.error(`Failed to expire payment ${payment.id}: ${err.message}`);
        await this.adminAlerts.raise({
          type: AdminAlertType.STELLAR_MONITOR,
          dedupeKey: `stellar-monitor.expire:${payment.id}`,
          message: `Failed to expire payment ${payment.reference}: ${err.message}`,
          metadata: { paymentId: payment.id },
          thresholdValue: 1,
        });
      }
    }
  }

  private markRunSuccess(): void {
    this.lastRunAt = new Date();
    this.lastRunStatus = 'ok';
    this.lastRunError = null;
  }

  private markRunFailure(error: unknown): void {
    this.lastRunAt = new Date();
    this.lastRunStatus = 'error';
    this.lastRunError = error instanceof Error ? error.message : String(error);
  }
}

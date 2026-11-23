import { InjectQueue } from '@nestjs/bull';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bull';
import { Repository } from 'typeorm';
import { DEFAULT_QUEUE_JOB, QUEUE_NAMES } from '../queues/queue.constants';
import { CronJobService } from '../cron/cron-job.service';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { SorobanIndexerCursor } from './entities/soroban-indexer-cursor.entity';
import {
  PaymentConfirmedEventDto,
  SettlementCompletedEventDto,
  SorobanContractEventDto,
  SorobanRpcEvent,
} from './soroban-event.dto';

interface SorobanEventsResponse {
  events: SorobanRpcEvent[];
  latestLedger: number;
}

interface SorobanRpcEventsResponse {
  error?: unknown;
  result?: { events?: SorobanRpcEvent[]; latestLedger?: number | string };
}

const CURSOR_NAME = 'soroban-event-indexer';
const PAGE_LIMIT = 200;
const RPC_TIMEOUT_MS = 10_000;
const MAX_SKIPPED_POLLS = 3;

@Injectable()
export class SorobanEventIndexer {
  private readonly logger = new Logger(SorobanEventIndexer.name);
  private readonly rpcUrl: string;
  private readonly contractId: string;
  private polling = false;
  private skippedPolls = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue(QUEUE_NAMES.sorobanEventDlq) private readonly dlq: Queue,
    private readonly cronJobService: CronJobService,
    private readonly adminAlertService: AdminAlertService,
    @InjectRepository(SorobanIndexerCursor)
    private readonly cursorRepo: Repository<SorobanIndexerCursor>,
  ) {
    this.rpcUrl = this.config.get<string>(
      'SOROBAN_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
    this.contractId = this.config.get<string>(
      'SOROBAN_CONTRACT_ID',
      this.config.get<string>('STELLAR_USDC_CONTRACT_ID', ''),
    );
  }

  @Cron('*/5 * * * * *')
  async pollEvents(): Promise<void> {
    if (this.polling) {
      this.skippedPolls++;
      this.logger.debug('Skipping poll: previous Soroban cycle still running');
      if (this.skippedPolls > MAX_SKIPPED_POLLS) {
        await this.adminAlertService.sendAlert({
          severity: 'critical',
          title: 'Soroban event indexer stalled',
          message: `Soroban event indexing has been skipped ${this.skippedPolls} consecutive cycles because a previous poll is still in flight. On-chain event indexing may be halted.`,
        });
      }
      return;
    }

    if (!this.contractId) {
      this.logger.debug('SOROBAN_CONTRACT_ID not configured; skipping event indexing');
      return;
    }

    this.polling = true;
    try {
      await this.cronJobService.run('soroban-event-indexer', async () => {
          const lastLedger = await this.readCursor();
          let startLedger = lastLedger > 0 ? lastLedger + 1 : undefined;
          let cursorLedger = lastLedger;
          let pageCursor: string | undefined;
          let eventCount = 0;

          while (true) {
            const { events, latestLedger } = await this.getEvents(startLedger, pageCursor);

            if (!events.length) {
              cursorLedger = Math.max(cursorLedger, latestLedger);
              break;
            }

            for (const event of events) {
              try {
                const dto = this.parseEvent(event);
                if (!dto) continue;
                await this.dispatch(dto);
                eventCount++;
                cursorLedger = Math.max(cursorLedger, event.ledger ?? cursorLedger);
              } catch (error) {
                await this.enqueueDeadLetter(event, error as Error);
              }
            }

            if (events.length < PAGE_LIMIT) break;
            pageCursor = events[events.length - 1]?.pagingToken;
            startLedger = undefined;
          }

          if (cursorLedger > lastLedger) {
            await this.writeCursor(cursorLedger);
          }

          return eventCount;
      });
      this.skippedPolls = 0;
    } finally {
      this.polling = false;
    }
  }

  /** Rewinds the persisted cursor to fromLedger and re-indexes from there. Already-dispatched events are dispatched again. */
  async replayFrom(fromLedger: number): Promise<void> {
    if (this.polling) {
      throw new ConflictException('Soroban event indexer is already polling; retry shortly');
    }
    await this.writeCursor(fromLedger - 1);
    await this.pollEvents();
  }

  private async readCursor(): Promise<number> {
    const row = await this.cursorRepo.findOne({ where: { name: CURSOR_NAME } });
    return row?.ledger ?? 0;
  }

  private async writeCursor(ledger: number): Promise<void> {
    await this.cursorRepo.upsert({ name: CURSOR_NAME, ledger }, ['name']);
  }

  private async dispatch(dto: SorobanContractEventDto): Promise<void> {
    if (dto.topic === 'payment.confirmed') {
      await this.eventEmitter.emitAsync('soroban.payment.confirmed', dto);
      return;
    }

    if (dto.topic === 'settlement.completed') {
      await this.eventEmitter.emitAsync('soroban.settlement.completed', dto);
    }
  }

  private parseEvent(raw: SorobanRpcEvent): SorobanContractEventDto | null {
    const [topic] = raw.topic ?? [];
    if (!topic) return null;

    if (topic === 'payment_confirmed') {
      return this.toPaymentConfirmedDto(raw);
    }

    if (topic === 'settlement_completed') {
      return this.toSettlementCompletedDto(raw);
    }

    return null;
  }

  private toPaymentConfirmedDto(raw: SorobanRpcEvent): PaymentConfirmedEventDto {
    const value = raw.value ?? {};
    const paymentReference = String(value.paymentReference ?? value.reference ?? '');
    const txHash = String(value.txHash ?? '');
    const amount = Number(value.amount ?? 0);
    const asset = String(value.asset ?? 'USDC');

    if (!paymentReference || !txHash || Number.isNaN(amount)) {
      throw new Error(`Invalid payment_confirmed event payload: ${JSON.stringify(raw.value)}`);
    }

    return {
      topic: 'payment.confirmed',
      eventId: raw.id,
      pagingToken: raw.pagingToken,
      ledger: raw.ledger,
      ledgerClosedAt: new Date(raw.ledgerClosedAt),
      contractId: raw.contractId,
      rawTopic: raw.topic,
      paymentReference,
      txHash,
      amount,
      asset,
      from: typeof value.from === 'string' ? value.from : undefined,
    };
  }

  private toSettlementCompletedDto(raw: SorobanRpcEvent): SettlementCompletedEventDto {
    const value = raw.value ?? {};
    const settlementId = String(value.settlementId ?? value.reference ?? '');
    const partnerReference =
      typeof value.partnerReference === 'string'
        ? value.partnerReference
        : undefined;

    if (!settlementId) {
      throw new Error(`Invalid settlement_completed event payload: ${JSON.stringify(raw.value)}`);
    }

    return {
      topic: 'settlement.completed',
      eventId: raw.id,
      pagingToken: raw.pagingToken,
      ledger: raw.ledger,
      ledgerClosedAt: new Date(raw.ledgerClosedAt),
      contractId: raw.contractId,
      rawTopic: raw.topic,
      settlementId,
      partnerReference,
    };
  }

  private async getEvents(
    startLedger?: number,
    cursor?: string,
  ): Promise<SorobanEventsResponse> {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getEvents',
      params: {
        startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [this.contractId],
          },
        ],
        pagination: {
          limit: PAGE_LIMIT,
          cursor,
        },
      },
    };

    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Soroban RPC HTTP ${response.status}: ${await response.text()}`);
    }

    const json = (await response.json()) as SorobanRpcEventsResponse;
    if (json.error) {
      throw new Error(`Soroban RPC error: ${JSON.stringify(json.error)}`);
    }

    return {
      events: json.result?.events ?? [],
      latestLedger: Number(json.result?.latestLedger ?? 0),
    };
  }

  private async enqueueDeadLetter(event: SorobanRpcEvent, error: Error): Promise<void> {
    this.logger.error(`Failed to process Soroban event ${event.id}: ${error.message}`);
    await this.dlq.add(DEFAULT_QUEUE_JOB, {
      source: 'soroban-indexer',
      event,
      error: error.message,
      failedAt: new Date().toISOString(),
    });
  }
}

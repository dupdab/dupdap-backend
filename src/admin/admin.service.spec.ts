import { AdminService, ABANDONED_PAYMENT_STATUSES, PENDING_PAYMENT_STATUSES } from './admin.service';
import { PaymentStatus } from '../payments/entities/payment.entity';

describe('AdminService payment funnel rates', () => {
  let service: AdminService;

  beforeEach(() => {
    // computeFunnelRates is pure; no repositories are exercised.
    service = new AdminService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('counts only EXPIRED and FAILED as abandoned', () => {
    expect(ABANDONED_PAYMENT_STATUSES).toEqual([
      PaymentStatus.EXPIRED,
      PaymentStatus.FAILED,
    ]);
  });

  it('does not count SETTLING payments as abandoned', () => {
    const { abandonmentRate, pendingRate } = service.computeFunnelRates({
      [PaymentStatus.COMPLETED]: 2,
      [PaymentStatus.SETTLING]: 3,
      [PaymentStatus.EXPIRED]: 1,
      [PaymentStatus.FAILED]: 1,
    });

    // 2 abandoned out of 7 total; SETTLING (3) must not be abandoned.
    expect(abandonmentRate).toBeCloseTo(2 / 7);
    // SETTLING + PENDING are in-flight.
    expect(pendingRate).toBeCloseTo(3 / 7);
  });

  it('reports pendingRate for in-flight payments', () => {
    expect(PENDING_PAYMENT_STATUSES).toEqual([
      PaymentStatus.PENDING,
      PaymentStatus.SETTLING,
    ]);

    const { abandonmentRate, pendingRate } = service.computeFunnelRates({
      [PaymentStatus.PENDING]: 1,
      [PaymentStatus.SETTLING]: 1,
      [PaymentStatus.COMPLETED]: 2,
    });

    expect(abandonmentRate).toBe(0);
    expect(pendingRate).toBeCloseTo(0.5);
  });

  it('returns zero rates when there are no payments', () => {
    expect(service.computeFunnelRates({})).toEqual({
      abandonmentRate: 0,
      pendingRate: 0,
    });
  });
});

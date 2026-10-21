export enum PaymentStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  SETTLING = 'SETTLING',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export class InvalidStateTransitionException extends Error {
  constructor(
    public readonly from: PaymentStatus,
    public readonly to: PaymentStatus,
  ) {
    super(`Invalid payment state transition: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionException';
  }
}

const ALLOWED_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  [PaymentStatus.PENDING]: [PaymentStatus.CONFIRMED, PaymentStatus.FAILED, PaymentStatus.CANCELLED],
  [PaymentStatus.CONFIRMED]: [PaymentStatus.SETTLING, PaymentStatus.FAILED, PaymentStatus.CANCELLED],
  [PaymentStatus.SETTLING]: [PaymentStatus.SETTLED, PaymentStatus.FAILED],
  [PaymentStatus.SETTLED]: [],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.CANCELLED]: [],
};

export class PaymentStateMachine {
  static readonly transitions = ALLOWED_TRANSITIONS;

  static canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
  }

  static assertTransition(from: PaymentStatus, to: PaymentStatus): void {
    if (!PaymentStateMachine.canTransition(from, to)) {
      throw new InvalidStateTransitionException(from, to);
    }
  }

  static transition(from: PaymentStatus, to: PaymentStatus): PaymentStatus {
    PaymentStateMachine.assertTransition(from, to);
    return to;
  }

  static allowedTransitions(from: PaymentStatus): readonly PaymentStatus[] {
    return ALLOWED_TRANSITIONS[from] ?? [];
  }

  static isTerminal(status: PaymentStatus): boolean {
    return (ALLOWED_TRANSITIONS[status] ?? []).length === 0;
  }
}

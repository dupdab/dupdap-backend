import Big from 'big.js';

/**
 * Precision-safe helpers for `payment.amountUsd`, which is persisted as a
 * string (numeric column). Never use Number()/parseFloat() on these values.
 */
export const AMOUNT_USD_DECIMAL_PLACES = 6;

export function toAmountUsd(value: string | number | Big): Big {
  return new Big(value);
}

export function addAmountUsd(a: string | number | Big, b: string | number | Big): Big {
  return toAmountUsd(a).plus(toAmountUsd(b));
}

export function subAmountUsd(a: string | number | Big, b: string | number | Big): Big {
  return toAmountUsd(a).minus(toAmountUsd(b));
}

export function mulAmountUsd(a: string | number | Big, b: string | number | Big): Big {
  return toAmountUsd(a).times(toAmountUsd(b));
}

export function divAmountUsd(a: string | number | Big, b: string | number | Big): Big {
  return toAmountUsd(a).div(toAmountUsd(b));
}

export function isPositiveAmountUsd(value: string | number | Big): boolean {
  return toAmountUsd(value).gt(0);
}

export function isZeroAmountUsd(value: string | number | Big): boolean {
  return toAmountUsd(value).eq(0);
}

export function compareAmountUsd(a: string | number | Big, b: string | number | Big): number {
  return toAmountUsd(a).cmp(toAmountUsd(b));
}

/** Serialize back to the DB string representation without precision loss. */
export function formatAmountUsd(value: string | number | Big): string {
  return toAmountUsd(value).toFixed(AMOUNT_USD_DECIMAL_PLACES);
}

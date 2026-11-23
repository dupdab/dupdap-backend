import { ValueTransformer } from 'typeorm';

export class NumericTransformer implements ValueTransformer {
  to(value?: number | null): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    return value;
  }

  from(value?: string | number | null): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    return typeof value === 'number' ? value : parseFloat(value);
  }
}

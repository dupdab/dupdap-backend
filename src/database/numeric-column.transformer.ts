import { ValueTransformer } from 'typeorm';

/**
 * Postgres numeric/decimal columns are returned by node-postgres/TypeORM as
 * strings (to avoid float precision loss on write). This transformer keeps
 * them as strings on read so that exact decimal precision is preserved
 * through the entity layer — avoiding the IEEE-754 floating-point drift
 * that parseFloat reintroduces on every read/write round-trip.
 */
export const numericColumnTransformer: ValueTransformer = {
  to(value: string | null | undefined): string | null | undefined {
    return value;
  },
  from(value: string | null): string | null {
    if (value === null || value === undefined) return null;
    return value;
  },
};

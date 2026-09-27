import { ValueTransformer } from 'typeorm';

/**
 * Postgres numeric/decimal columns are returned by node-postgres/TypeORM as
 * strings (to avoid float precision loss on write). This transformer parses
 * them back to a JS number on read so the TypeScript `number` type on the
 * entity property actually matches the runtime value.
 */
export const numericColumnTransformer: ValueTransformer = {
  to(value: number | null | undefined): number | null | undefined {
    return value;
  },
  from(value: string | null): number | null {
    if (value === null || value === undefined) return null;
    return parseFloat(value);
  },
};

/**
 * Minimal type declarations for `big.js`.
 *
 * The package ships without its own typings, so the subset of the API used by
 * this codebase is declared here.
 */
declare module 'big.js' {
  type BigSource = Big | number | string;

  class Big {
    constructor(value: BigSource);

    toString(base?: number): string;
    toFixed(decimalPlaces?: number): string;
    toNumber(): number;

    plus(value: BigSource): Big;
    minus(value: BigSource): Big;
    times(value: BigSource): Big;
    div(value: BigSource): Big;
    mod(value: BigSource): Big;
    pow(value: BigSource): Big;

    eq(value: BigSource): boolean;
    lt(value: BigSource): boolean;
    lte(value: BigSource): boolean;
    gt(value: BigSource): boolean;
    gte(value: BigSource): boolean;

    abs(): Big;
    negated(): Big;
    comparedTo(value: BigSource): number;
  }

  export = Big;
}

import { parseCsv } from './payment-import.csv';

describe('parseCsv', () => {
  it('parses quoted commas, escaped quotes, and embedded newlines', () => {
    expect(parseCsv('amount,description\n12,"Order, ""A"""\n13,"line one\nline two"')).toEqual([
      ['amount', 'description'],
      ['12', 'Order, "A"'],
      ['13', 'line one\nline two'],
    ]);
  });

  it('rejects an unclosed quoted field', () => {
    expect(() => parseCsv('amount,description\n12,"unfinished')).toThrow('unclosed quoted field');
  });
});

import { NumericTransformer } from './numeric.transformer';

describe('NumericTransformer', () => {
  let transformer: NumericTransformer;

  beforeEach(() => {
    transformer = new NumericTransformer();
  });

  describe('to', () => {
    it('should return the numeric value unchanged', () => {
      expect(transformer.to(42)).toBe(42);
      expect(transformer.to(3.14)).toBe(3.14);
    });

    it('should return null when value is null', () => {
      expect(transformer.to(null)).toBeNull();
    });

    it('should return undefined when value is undefined', () => {
      expect(transformer.to(undefined)).toBeUndefined();
    });
  });

  describe('from', () => {
    it('should convert a numeric string to a number', () => {
      expect(transformer.from('42')).toBe(42);
      expect(transformer.from('3.14')).toBe(3.14);
    });

    it('should return a number unchanged', () => {
      expect(transformer.from(42)).toBe(42);
    });

    it('should return null when value is null', () => {
      expect(transformer.from(null)).toBeNull();
    });

    it('should return null when value is undefined', () => {
      expect(transformer.from(undefined)).toBeNull();
    });
  });
});

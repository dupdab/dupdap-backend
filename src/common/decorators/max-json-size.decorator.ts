import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

/**
 * Validates that the JSON-serialized size of a property does not exceed
 * maxBytes. Used to cap arbitrary/unbounded object fields (e.g. metadata)
 * stored directly into jsonb columns, preventing oversized payloads.
 */
export function MaxJsonSize(maxBytes: number, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'maxJsonSize',
      target: object.constructor,
      propertyName,
      constraints: [maxBytes],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (value === undefined || value === null) return true;
          const [limit] = args.constraints;
          try {
            const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
            return size <= limit;
          } catch {
            return false;
          }
        },
        defaultMessage(args: ValidationArguments) {
          const [limit] = args.constraints;
          return `${args.property} must not exceed ${limit} bytes when serialized`;
        },
      },
    });
  };
}

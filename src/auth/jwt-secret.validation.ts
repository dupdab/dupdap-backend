import * as Joi from 'joi';

/** Minimum accepted length for JWT_SECRET (HS256 key material). */
export const JWT_SECRET_MIN_LENGTH = 32;

/**
 * Startup validation schema for the auth module (#835).
 *
 * A short JWT_SECRET is silently accepted by jsonwebtoken, which makes tokens
 * trivially brute-forceable. Validating it here makes the app fail fast with a
 * clear error instead of booting with weak key material.
 */
export const jwtSecretValidationSchema = Joi.object({
  JWT_SECRET: Joi.string()
    .min(JWT_SECRET_MIN_LENGTH)
    .required()
    .messages({
      'string.base': 'JWT_SECRET must be a string',
      'string.empty': 'JWT_SECRET must not be empty',
      'string.min': `JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters long`,
      'any.required': 'JWT_SECRET is required',
    }),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
}).unknown(true);

/**
 * Validates the given environment object against the JWT secret schema.
 * Throws an Error with a clear message when JWT_SECRET is missing or too short.
 */
export function validateJwtSecretConfig(
  env: Record<string, unknown>,
): Record<string, unknown> {
  const { error, value } = jwtSecretValidationSchema.validate(env, {
    abortEarly: false,
    allowUnknown: true,
  });

  if (error) {
    throw new Error(
      `Invalid JWT configuration: ${error.details.map((d) => d.message).join('; ')}`,
    );
  }

  return value as Record<string, unknown>;
}

import * as Joi from 'joi';

// Fail-fast schema — ConfigModule throws at boot if these are missing/invalid.
export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.string().default('900s'),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  PORT: Joi.number().default(3001),
}).unknown(true);

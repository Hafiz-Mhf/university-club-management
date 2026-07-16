import * as Joi from 'joi';

// Fail-fast schema — ConfigModule throws at boot if these are missing/invalid.
export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required().invalid(Joi.ref('JWT_ACCESS_SECRET')),
  ATTENDANCE_TOKEN_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.string().default('900s'),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  PORT: Joi.number().default(3001),
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  MAIL_HOST: Joi.string().default('localhost'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_USER: Joi.string().allow('').default(''),
  MAIL_PASS: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().default('University Club Platform <no-reply@ucm.local>'),
}).unknown(true);

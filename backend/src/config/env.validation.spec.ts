import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  const valid = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'a'.repeat(16),
    JWT_REFRESH_SECRET: 'b'.repeat(16),
    ATTENDANCE_TOKEN_SECRET: 'c'.repeat(16),
  };

  it('accepts a valid env and applies defaults', () => {
    const { error, value } = envValidationSchema.validate(valid);
    expect(error).toBeUndefined();
    expect(value.JWT_ACCESS_TTL).toBe('900s');
    expect(value.PORT).toBe(3001);
    expect(value.REDIS_URL).toBe('redis://localhost:6379');
    expect(value.MAIL_HOST).toBe('localhost');
    expect(value.MAIL_PORT).toBe(1025);
    expect(value.MAIL_USER).toBe('');
    expect(value.MAIL_PASS).toBe('');
    expect(value.MAIL_FROM).toBe('University Club Platform <no-reply@ucm.local>');
  });

  it('rejects a missing JWT_ACCESS_SECRET', () => {
    const { error } = envValidationSchema.validate({
      ...valid,
      JWT_ACCESS_SECRET: undefined,
    });
    expect(error).toBeDefined();
  });

  it('rejects a missing ATTENDANCE_TOKEN_SECRET', () => {
    const { error } = envValidationSchema.validate({
      ...valid,
      ATTENDANCE_TOKEN_SECRET: undefined,
    });
    expect(error).toBeDefined();
  });

  it('rejects a too-short secret (< 16 chars)', () => {
    const { error } = envValidationSchema.validate({ ...valid, JWT_ACCESS_SECRET: 'short' });
    expect(error).toBeDefined();
  });

  it('rejects identical access and refresh secrets', () => {
    const { error } = envValidationSchema.validate({
      ...valid,
      JWT_ACCESS_SECRET: 'x'.repeat(20),
      JWT_REFRESH_SECRET: 'x'.repeat(20),
    });
    expect(error).toBeDefined();
  });
});

import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  const valid = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'a'.repeat(16),
    JWT_REFRESH_SECRET: 'b'.repeat(16),
  };

  it('accepts a valid env and applies defaults', () => {
    const { error, value } = envValidationSchema.validate(valid);
    expect(error).toBeUndefined();
    expect(value.JWT_ACCESS_TTL).toBe('900s');
    expect(value.PORT).toBe(3001);
  });

  it('rejects a missing JWT_ACCESS_SECRET', () => {
    const { error } = envValidationSchema.validate({
      ...valid,
      JWT_ACCESS_SECRET: undefined,
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

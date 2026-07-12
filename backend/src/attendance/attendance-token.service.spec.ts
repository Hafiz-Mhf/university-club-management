import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AttendanceTokenService } from './attendance-token.service';

describe('AttendanceTokenService', () => {
  let service: AttendanceTokenService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AttendanceTokenService,
        { provide: ConfigService, useValue: { get: () => 'test_secret_at_least_16_chars' } },
      ],
    }).compile();
    service = moduleRef.get(AttendanceTokenService);
  });

  it('signs then verifies round-trip to the original attendanceId', () => {
    const token = service.sign('11111111-1111-1111-1111-111111111111');
    expect(service.verify(token)).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('rejects a token with a tampered signature', () => {
    const token = service.sign('11111111-1111-1111-1111-111111111111');
    const [id, sig] = token.split('.');
    const tampered = `${id}.${sig.slice(0, -1)}${sig.at(-1) === 'a' ? 'b' : 'a'}`;
    expect(service.verify(tampered)).toBeNull();
  });

  it('rejects a token with a tampered id (signature no longer matches)', () => {
    const token = service.sign('11111111-1111-1111-1111-111111111111');
    const [, sig] = token.split('.');
    const tampered = `22222222-2222-2222-2222-222222222222.${sig}`;
    expect(service.verify(tampered)).toBeNull();
  });

  it('rejects a malformed token (no separator)', () => {
    expect(service.verify('not-a-valid-token')).toBeNull();
  });
});

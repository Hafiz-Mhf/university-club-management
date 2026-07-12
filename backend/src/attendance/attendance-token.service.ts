import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AttendanceTokenService {
  constructor(private readonly config: ConfigService) {}

  sign(attendanceId: string): string {
    return `${attendanceId}.${this.signature(attendanceId)}`;
  }

  // Returns the attendanceId if the token is well-formed and its signature
  // matches; null on any failure. Never throws — callers treat null as
  // "invalid token", not a 500.
  verify(token: string): string | null {
    const separatorIndex = token.lastIndexOf('.');
    if (separatorIndex === -1) return null;
    const attendanceId = token.slice(0, separatorIndex);
    const presentedSignature = token.slice(separatorIndex + 1);

    const expectedSignature = this.signature(attendanceId);
    const expected = Buffer.from(expectedSignature);
    const presented = Buffer.from(presentedSignature);
    // timingSafeEqual throws on length mismatch rather than returning false —
    // an attacker-controlled presented value must not crash the request.
    if (expected.length !== presented.length) return null;
    if (!timingSafeEqual(expected, presented)) return null;

    return attendanceId;
  }

  private signature(attendanceId: string): string {
    const secret = this.config.get<string>('ATTENDANCE_TOKEN_SECRET')!;
    return createHmac('sha256', secret).update(attendanceId).digest('base64url');
  }
}

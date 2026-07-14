import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Attendance tenant isolation (e2e)', () => {
  let app: INestApplication;
  let aToken: string;
  let aOrgId: string;
  let aEventId: string;
  let bToken: string;
  let bOrgId: string;
  let bEventId: string;
  let bAttendanceId: string;
  let bAttendanceToken: string;
  const a = `aia-${Date.now()}@test.io`;
  const b = `aib-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function setupOrgEvent(token: string, tag: string) {
    const orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${token}`).send({ name: `Iso${tag}`, slug: `iso-${tag}-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${token}`).send({ title: 'Iso Event', startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    return { orgId, eventId: event.body.id as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    aToken = await registerAndLogin(a);
    ({ orgId: aOrgId, eventId: aEventId } = await setupOrgEvent(aToken, 'a'));

    bToken = await registerAndLogin(b);
    ({ orgId: bOrgId, eventId: bEventId } = await setupOrgEvent(bToken, 'b'));
    // B's own president registers for B's own event, so there's a real
    // Attendance row that A must never be able to touch.
    await request(app.getHttpServer())
      .post(`/organizations/${bOrgId}/events/${bEventId}/registrations`)
      .set('Authorization', `Bearer ${bToken}`).send({}).expect(201);
    const mine = await request(app.getHttpServer())
      .get(`/organizations/${bOrgId}/events/${bEventId}/attendance/me`)
      .set('Authorization', `Bearer ${bToken}`).expect(200);
    bAttendanceId = mine.body.id;
    bAttendanceToken = mine.body.token;
  });
  afterAll(async () => { await app.close(); });

  it('A cannot list B attendance', async () => {
    await request(app.getHttpServer())
      .get(`/organizations/${bOrgId}/events/${bEventId}/attendance`)
      .set('Authorization', `Bearer ${aToken}`).expect(403);
  });

  it('A cannot scan B\'s attendance token via B\'s own org path', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${bOrgId}/events/${bEventId}/attendance/scan`)
      .set('Authorization', `Bearer ${aToken}`).send({ token: bAttendanceToken }).expect(403);
  });

  it('A cannot mark B\'s attendance absent', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${bOrgId}/events/${bEventId}/attendance/${bAttendanceId}/absent`)
      .set('Authorization', `Bearer ${aToken}`).expect(403);
  });

  it('A cannot read B\'s attendance /me (no membership in B)', async () => {
    await request(app.getHttpServer())
      .get(`/organizations/${bOrgId}/events/${bEventId}/attendance/me`)
      .set('Authorization', `Bearer ${aToken}`).expect(403);
  });

  it('id-guessing: scanning B\'s token through A\'s own org + A\'s eventId gives 404, not B\'s data', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${aOrgId}/events/${aEventId}/attendance/scan`)
      .set('Authorization', `Bearer ${aToken}`).send({ token: bAttendanceToken }).expect(404);
  });

  it('id-guessing: marking B\'s attendanceId absent through A\'s org + A\'s eventId gives 404', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${aOrgId}/events/${aEventId}/attendance/${bAttendanceId}/absent`)
      .set('Authorization', `Bearer ${aToken}`).expect(404);
  });

  it('id-guessing: listing via A\'s org + B\'s eventId returns empty, not B\'s rows', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${aOrgId}/events/${bEventId}/attendance`)
      .set('Authorization', `Bearer ${aToken}`).expect(200);
    expect(res.body).toEqual([]);
  });

  it('B\'s attendance record survives all of A\'s isolation attempts', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${bOrgId}/events/${bEventId}/attendance/me`)
      .set('Authorization', `Bearer ${bToken}`).expect(200);
    expect(res.body.status).toBe('REGISTERED');
  });

  // --- Same-org role-gate cases (membership valid, role insufficient) ---
  // A plain PARTICIPANT of B's own org/event — registered via the normal
  // self-registration path, which auto-enrolls them as PARTICIPANT — must
  // still be blocked by RolesGuard, not merely TenantGuard. This proves the
  // 403s above for A are a genuine membership gate and not accidentally the
  // same role gate that would also stop a legitimate same-org member.
  describe('same-org participant (valid membership, insufficient role)', () => {
    let participantToken: string;
    let participantAttendanceId: string;
    let participantAttendanceToken: string;

    beforeAll(async () => {
      const email = `aip-${Date.now()}@test.io`;
      participantToken = await registerAndLogin(email);
      await request(app.getHttpServer())
        .post(`/organizations/${bOrgId}/events/${bEventId}/registrations`)
        .set('Authorization', `Bearer ${participantToken}`).send({}).expect(201);
      const mine = await request(app.getHttpServer())
        .get(`/organizations/${bOrgId}/events/${bEventId}/attendance/me`)
        .set('Authorization', `Bearer ${participantToken}`).expect(200);
      participantAttendanceId = mine.body.id;
      participantAttendanceToken = mine.body.token;
    });

    it('403s scanning their own valid attendance token (RolesGuard, not TenantGuard)', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${bOrgId}/events/${bEventId}/attendance/scan`)
        .set('Authorization', `Bearer ${participantToken}`).send({ token: participantAttendanceToken }).expect(403);
    });

    it('403s marking their own attendance absent (RolesGuard, not TenantGuard)', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${bOrgId}/events/${bEventId}/attendance/${participantAttendanceId}/absent`)
        .set('Authorization', `Bearer ${participantToken}`).expect(403);
    });
  });
});

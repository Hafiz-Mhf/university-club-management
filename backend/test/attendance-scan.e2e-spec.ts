import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Attendance list + scan (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `sc-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'ScanOrg', slug: `sc-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Scan Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  async function registerParticipant() {
    const token = await registerAndLogin(`sp-${Date.now()}-${Math.random()}@test.io`);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const mine = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    return { token, attendanceToken: mine.body.token as string, attendanceId: mine.body.id as string };
  }

  it('MANAGE_ATTENDANCE holder (president) lists attendance for the event', async () => {
    await registerParticipant();
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/attendance`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('a plain participant cannot list attendance (403)', async () => {
    const { token } = await registerParticipant();
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/attendance`)
      .set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('scans a valid token and marks the attendee PRESENT', async () => {
    const { attendanceToken } = await registerParticipant();
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: attendanceToken }).expect(200);
    expect(res.body.status).toBe('PRESENT');
  });

  it('409 re-scanning an already-scanned token', async () => {
    const { attendanceToken } = await registerParticipant();
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: attendanceToken }).expect(200);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: attendanceToken }).expect(409);
  });

  it('400 scanning a tampered token', async () => {
    const { attendanceToken } = await registerParticipant();
    const tampered = attendanceToken.slice(0, -1) + (attendanceToken.at(-1) === 'a' ? 'b' : 'a');
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: tampered }).expect(400);
  });

  it('404 scanning a well-formed token for an attendance row in a different event', async () => {
    const otherEvent = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Other Event', startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${otherEvent.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const { attendanceToken } = await registerParticipant(); // registered for `eventId`, not `otherEvent`
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${otherEvent.body.id}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: attendanceToken }).expect(404);
  });
});

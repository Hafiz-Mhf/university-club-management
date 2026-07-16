import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Analytics overview (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `an-ov-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AnOvOrg', slug: `an-ov-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Overview Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('returns null attendanceRate for a fresh org with no resolved attendance', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/overview`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.attendanceRate).toBeNull();
  });

  it('computes attendanceRate as PRESENT / (PRESENT + ABSENT), excluding still-REGISTERED rows', async () => {
    // Participant A: scanned PRESENT.
    const tokenA = await registerAndLogin(`ov-a-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${tokenA}`).send({}).expect(201);
    const mineA = await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: mineA.body.token }).expect(200);

    // Participant B: marked ABSENT.
    const tokenB = await registerAndLogin(`ov-b-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${tokenB}`).send({}).expect(201);
    const mineB = await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${tokenB}`).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/attendance/${mineB.body.id}/absent`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    // Participant C: registered, still REGISTERED (excluded from the ratio).
    const tokenC = await registerAndLogin(`ov-c-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${tokenC}`).send({}).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/overview`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.attendanceRate).toBe(0.5);
  });

  it('a plain participant cannot view analytics (403)', async () => {
    const token = await registerAndLogin(`ov-p-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/overview`)
      .set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('cross-org isolation: org B president cannot view org A overview (403)', async () => {
    const otherPresToken = await registerAndLogin(`ov-other-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AnOvOtherOrg', slug: `an-ov-other-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/overview`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});

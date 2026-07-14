import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Capacity + waitlist (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `cap-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }
  async function register(token: string) {
    return request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({});
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'CapOrg', slug: `cap-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Small Event', startAt: future(5), endAt: future(6), capacity: 1 });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('fills capacity, waitlists the next two, and promotes the oldest waitlisted on cancel', async () => {
    const t1 = await registerAndLogin(`cap1-${Date.now()}@test.io`);
    const r1 = await register(t1);
    expect(r1.status).toBe(201);
    expect(r1.body.status).toBe('APPROVED');

    const t2 = await registerAndLogin(`cap2-${Date.now()}@test.io`);
    const r2 = await register(t2);
    expect(r2.status).toBe(201);
    expect(r2.body.status).toBe('WAITLISTED');

    const t3 = await registerAndLogin(`cap3-${Date.now()}@test.io`);
    const r3 = await register(t3);
    expect(r3.status).toBe(201);
    expect(r3.body.status).toBe('WAITLISTED');

    // cancel the APPROVED registration -> oldest WAITLISTED (r2) promotes, not r3
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${r1.body.id}/cancel`)
      .set('Authorization', `Bearer ${t1}`).expect(200);

    const r2check = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/registrations/me`)
      .set('Authorization', `Bearer ${t2}`).expect(200);
    expect(r2check.body.status).toBe('APPROVED');

    const r3check = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/registrations/me`)
      .set('Authorization', `Bearer ${t3}`).expect(200);
    expect(r3check.body.status).toBe('WAITLISTED');
  });

  // Regression: two concurrent cancels of two DIFFERENT APPROVED registrations
  // on the same event both race to promote the SAME oldest-WAITLISTED row.
  // Before the fix, the losing promote's P2025 aborted its whole transaction —
  // rolling back that caller's own valid cancel and returning a spurious 409.
  it('concurrent cancels of different APPROVED registrations both succeed and the waitlisted one promotes', async () => {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Concurrent Cancel Event', startAt: future(5), endAt: future(6), capacity: 2 });
    const raceEventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${raceEventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const registerRace = (token: string) => request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${raceEventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({});

    const ta = await registerAndLogin(`race-a-${Date.now()}@test.io`);
    const tb = await registerAndLogin(`race-b-${Date.now()}@test.io`);
    const tc = await registerAndLogin(`race-c-${Date.now()}@test.io`);

    const ra = await registerRace(ta);
    const rb = await registerRace(tb);
    const rc = await registerRace(tc);
    expect(ra.body.status).toBe('APPROVED');
    expect(rb.body.status).toBe('APPROVED');
    expect(rc.body.status).toBe('WAITLISTED');

    const [cancelA, cancelB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${raceEventId}/registrations/${ra.body.id}/cancel`)
        .set('Authorization', `Bearer ${ta}`),
      request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${raceEventId}/registrations/${rb.body.id}/cancel`)
        .set('Authorization', `Bearer ${tb}`),
    ]);
    expect(cancelA.status).toBe(200);
    expect(cancelB.status).toBe(200);

    const rcCheck = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${raceEventId}/registrations/me`)
      .set('Authorization', `Bearer ${tc}`).expect(200);
    expect(rcCheck.body.status).toBe('APPROVED');
  });
});

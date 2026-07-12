import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Attendance lifecycle (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `att-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }
  async function createEvent(capacity?: number) {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Att Event', startAt: future(5), endAt: future(6), capacity });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    return event.body.id as string;
  }
  async function registerFor(eventId: string, token: string) {
    return request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({});
  }
  function myAttendance(eventId: string, token: string) {
    return request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AttOrg', slug: `att-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('creates a REGISTERED attendance record when a registration is auto-approved', async () => {
    const eventId = await createEvent();
    const token = await registerAndLogin(`ok-${Date.now()}@test.io`);
    const reg = await registerFor(eventId, token);
    expect(reg.body.status).toBe('APPROVED');

    const res = await myAttendance(eventId, token).expect(200);
    expect(res.body.status).toBe('REGISTERED');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
  });

  it('does not create an attendance record while a registration is WAITLISTED', async () => {
    const eventId = await createEvent(1);
    const t1 = await registerAndLogin(`w1-${Date.now()}@test.io`);
    const t2 = await registerAndLogin(`w2-${Date.now()}@test.io`);
    await registerFor(eventId, t1);
    const r2 = await registerFor(eventId, t2);
    expect(r2.body.status).toBe('WAITLISTED');

    await myAttendance(eventId, t2).expect(404);
  });

  it('creates an attendance record when a waitlisted registration is promoted', async () => {
    const eventId = await createEvent(1);
    const t1 = await registerAndLogin(`p1-${Date.now()}@test.io`);
    const t2 = await registerAndLogin(`p2-${Date.now()}@test.io`);
    const r1 = await registerFor(eventId, t1);
    const r2 = await registerFor(eventId, t2);
    expect(r2.body.status).toBe('WAITLISTED');

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${r1.body.id}/cancel`)
      .set('Authorization', `Bearer ${t1}`).expect(200);

    const res = await myAttendance(eventId, t2).expect(200);
    expect(res.body.status).toBe('REGISTERED');
  });

  it('deletes the attendance record when an APPROVED registration is cancelled', async () => {
    const eventId = await createEvent();
    const token = await registerAndLogin(`c1-${Date.now()}@test.io`);
    const reg = await registerFor(eventId, token);
    await myAttendance(eventId, token).expect(200);

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${reg.body.id}/cancel`)
      .set('Authorization', `Bearer ${token}`).expect(200);

    await myAttendance(eventId, token).expect(404);
  });

  it('deletes the attendance record when an APPROVED registration is rejected', async () => {
    const eventId = await createEvent();
    const token = await registerAndLogin(`r1-${Date.now()}@test.io`);
    const reg = await registerFor(eventId, token);
    await myAttendance(eventId, token).expect(200);

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${reg.body.id}/reject`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    await myAttendance(eventId, token).expect(404);
  });
});

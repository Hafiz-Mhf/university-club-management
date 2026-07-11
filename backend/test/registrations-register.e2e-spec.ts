import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Register for an event (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `rg-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function login(email: string) {
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }
  async function register(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await register(pres);
    presToken = await login(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'RegOrg', slug: `reg-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Bare Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('a fresh user with no prior membership registers and is auto-enrolled as PARTICIPANT', async () => {
    const email = `newbie-${Date.now()}@test.io`;
    await register(email);
    const token = await login(email);
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    expect(res.body.status).toBe('APPROVED');

    const me = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/members/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.role).toBe('PARTICIPANT');
    expect(me.body.status).toBe('ACTIVE');
  });

  it('409 registering twice for the same event', async () => {
    const email = `dup-${Date.now()}@test.io`;
    await register(email);
    const token = await login(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(409);
  });

  it('404 registering for a DRAFT event', async () => {
    const draft = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Still Draft', startAt: future(5), endAt: future(6) });
    const email = `draftreg-${Date.now()}@test.io`;
    await register(email);
    const token = await login(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${draft.body.id}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(404);
  });

  it('400 when a required form field is missing', async () => {
    const formed = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Formed Event', startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer())
      .put(`/organizations/${orgId}/events/${formed.body.id}/registration-form`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ fields: [{ label: 'Full Name', type: 'TEXT', required: true, order: 0 }] }).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${formed.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const email = `formreg-${Date.now()}@test.io`;
    await register(email);
    const token = await login(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${formed.body.id}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({ answers: {} }).expect(400);
  });
});

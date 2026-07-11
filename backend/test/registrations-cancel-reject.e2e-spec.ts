import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Cancel + reject registration (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `cr-${Date.now()}@test.io`;
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
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'CROrg', slug: `cr-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'CR Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('owner cancels their own registration', async () => {
    const token = await registerAndLogin(`own-${Date.now()}@test.io`);
    const reg = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${reg.body.id}/cancel`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.status).toBe('CANCELLED');
  });

  it('a non-owner cannot cancel someone else\'s registration (403)', async () => {
    const ownerToken = await registerAndLogin(`owner2-${Date.now()}@test.io`);
    const reg = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${ownerToken}`).send({}).expect(201);
    const strangerToken = await registerAndLogin(`stranger-${Date.now()}@test.io`);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${reg.body.id}/cancel`)
      .set('Authorization', `Bearer ${strangerToken}`).expect(403);
  });

  it('MANAGE_EVENTS holder rejects a registration', async () => {
    const token = await registerAndLogin(`rej-${Date.now()}@test.io`);
    const reg = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${reg.body.id}/reject`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.status).toBe('REJECTED');
  });

  it('409 cancelling an already-cancelled registration', async () => {
    const token = await registerAndLogin(`dbl-${Date.now()}@test.io`);
    const reg = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${reg.body.id}/cancel`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${reg.body.id}/cancel`)
      .set('Authorization', `Bearer ${token}`).expect(409);
  });
});

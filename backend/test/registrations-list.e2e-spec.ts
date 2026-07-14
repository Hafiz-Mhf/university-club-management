import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('List + read own registration (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  let partToken: string;
  const pres = `rl-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await request(app.getHttpServer()).post('/auth/register').send({ email: pres, password: 'password123', fullName: pres, consent: true });
    presToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' })).body.accessToken;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'ListOrg', slug: `list-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'List Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const partEmail = `part-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register').send({ email: partEmail, password: 'password123', fullName: partEmail, consent: true });
    partToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: partEmail, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${partToken}`).send({}).expect(201);
  });
  afterAll(async () => { await app.close(); });

  it('MANAGE_EVENTS holder lists all registrations for the event', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('a participant cannot list all registrations (403)', async () => {
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${partToken}`).expect(403);
  });

  it('a participant reads their own registration', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/registrations/me`)
      .set('Authorization', `Bearer ${partToken}`).expect(200);
    expect(res.body.status).toBe('APPROVED');
  });
});

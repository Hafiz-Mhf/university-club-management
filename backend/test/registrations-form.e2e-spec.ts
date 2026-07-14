import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Registration form (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `rf-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await request(app.getHttpServer()).post('/auth/register').send({ email: pres, password: 'password123', fullName: pres, consent: true });
    presToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' })).body.accessToken;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'FormOrg', slug: `form-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Workshop', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('creates a form with fields', async () => {
    const res = await request(app.getHttpServer())
      .put(`/organizations/${orgId}/events/${eventId}/registration-form`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ fields: [
        { label: 'T-shirt size', type: 'SELECT', required: true, options: ['S', 'M', 'L'], order: 0 },
        { label: 'Dietary notes', type: 'TEXT', required: false, order: 1 },
      ] })
      .expect(200);
    expect(res.body.fields).toHaveLength(2);
  });

  it('reads the form', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/registration-form`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(200);
    expect(res.body.fields).toHaveLength(2);
  });

  it('400 when a SELECT field has no options', async () => {
    await request(app.getHttpServer())
      .put(`/organizations/${orgId}/events/${eventId}/registration-form`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ fields: [{ label: 'Broken', type: 'SELECT', order: 0 }] })
      .expect(400);
  });

  it('deletes the form', async () => {
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/events/${eventId}/registration-form`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(200);
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/registration-form`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(200);
    expect(res.body).toBeNull();
  });

  it('409 editing the form on a CANCELLED event', async () => {
    const cancelled = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Cancelled Event', startAt: future(2), endAt: future(3) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${cancelled.body.id}/cancel`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer())
      .put(`/organizations/${orgId}/events/${cancelled.body.id}/registration-form`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ fields: [{ label: 'X', type: 'TEXT', order: 0 }] })
      .expect(409);
  });
});

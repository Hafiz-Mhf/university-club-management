import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Events lifecycle (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let committeeToken: string;
  let orgId: string;
  const pres = `lp-${Date.now()}@test.io`;
  const committee = `lc-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
  const past = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

  async function createEvent(body: object): Promise<string> {
    const res = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send(body);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await request(app.getHttpServer()).post('/auth/register').send({ email: pres, password: 'password123', fullName: pres });
    presToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' })).body.accessToken;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'LifeOrg', slug: `life-${Date.now()}` })).body.id;
    await request(app.getHttpServer()).post('/auth/register').send({ email: committee, password: 'password123', fullName: committee });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: committee, role: 'COMMITTEE' });
    committeeToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: committee, password: 'password123' })).body.accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('publishes a DRAFT then completes it', async () => {
    const id = await createEvent({ title: 'Flow', startAt: future(2), endAt: future(3) });
    const pub = await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(pub.body.status).toBe('PUBLISHED');
    const done = await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${id}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(done.body.status).toBe('COMPLETED');
  });

  it('409 completing a DRAFT (not published)', async () => {
    const id = await createEvent({ title: 'NotYet', startAt: future(2), endAt: future(3) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${id}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(409);
  });

  it('409 publishing a past-dated event', async () => {
    const id = await createEvent({ title: 'Stale', startAt: past(3), endAt: past(2) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(409);
  });

  it('409 publishing twice', async () => {
    const id = await createEvent({ title: 'Twice', startAt: future(2), endAt: future(3) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(409);
  });

  it('cancels a DRAFT; then 409 cancelling again', async () => {
    const id = await createEvent({ title: 'Cancelme', startAt: future(2), endAt: future(3) });
    const res = await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${id}/cancel`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.status).toBe('CANCELLED');
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${id}/cancel`)
      .set('Authorization', `Bearer ${presToken}`).expect(409);
  });

  it('a COMMITTEE member may publish but not cancel (destructive tier)', async () => {
    const id = await createEvent({ title: 'TierCheck', startAt: future(2), endAt: future(3) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${id}/publish`)
      .set('Authorization', `Bearer ${committeeToken}`).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${id}/cancel`)
      .set('Authorization', `Bearer ${committeeToken}`).expect(403);
  });
});

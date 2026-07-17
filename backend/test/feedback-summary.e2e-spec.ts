import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Feedback summary (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
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
    presToken = await registerAndLogin(`fbsum-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'FbSumOrg', slug: `fbsum-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  async function createPublishedEvent(title: string) {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title, startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    return event.body.id;
  }

  async function presentParticipant(eventId: string) {
    const email = `fbsum-p-${Date.now()}-${Math.random()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const mine = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: mine.body.token }).expect(200);
    return token;
  }

  it('aggregates NPS + ratings across responses, without exposing any submitter identity', async () => {
    const eventId = await createPublishedEvent('Summary Event');
    const tokenA = await presentParticipant(eventId);
    const tokenB = await presentParticipant(eventId);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${tokenA}`).send({ npsScore: 10, contentRating: 5, organizationRating: 5, venueRating: 5, comment: 'Loved it' }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${tokenB}`).send({ npsScore: 6, contentRating: 3, organizationRating: 3, venueRating: 3 }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/feedback/summary`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    expect(res.body.responseCount).toBe(2);
    expect(res.body.avgNpsScore).toBe(8);
    expect(res.body.avgContentRating).toBe(4);
    expect(res.body.comments).toEqual(['Loved it']);
    expect(JSON.stringify(res.body)).not.toMatch(/userId/i);
  });

  it('403s a non-committee member (plain participant)', async () => {
    const eventId = await createPublishedEvent('Forbidden Summary Event');
    const token = await presentParticipant(eventId);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/feedback/summary`)
      .set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('cross-org isolation: org B president cannot view org A summary', async () => {
    const otherPresToken = await registerAndLogin(`fbsum-iso-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'FbSumIsoOrg', slug: `fbsum-iso-${Date.now()}` }).expect(201);

    const eventId = await createPublishedEvent('Isolation Summary Event');
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/feedback/summary`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});

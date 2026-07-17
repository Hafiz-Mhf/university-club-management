import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Analytics feedback (e2e)', () => {
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
    presToken = await registerAndLogin(`anfb-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'AnFbOrg', slug: `anfb-${Date.now()}` })).body.id;
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
    const email = `anfb-p-${Date.now()}-${Math.random()}@test.io`;
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

  it('getFeedback reports one entry per event with averages', async () => {
    const eventId = await createPublishedEvent('Analytics Feedback Event');
    const token = await presentParticipant(eventId);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send({ npsScore: 8, contentRating: 4, organizationRating: 4, venueRating: 4 }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/feedback`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const entry = res.body.data.find((d: { eventId: string }) => d.eventId === eventId);
    expect(entry).toBeDefined();
    expect(entry.responseCount).toBe(1);
    expect(entry.avgNpsScore).toBe(8);
  });

  it('getFeedbackTrends zero-fills the window and buckets by submission day', async () => {
    const eventId = await createPublishedEvent('Analytics Trend Event');
    const token = await presentParticipant(eventId);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send({ npsScore: 10, contentRating: 5, organizationRating: 5, venueRating: 5 }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/feedback-trends?days=7`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    expect(res.body.trend).toHaveLength(7);
    const today = new Date().toISOString().slice(0, 10);
    const todayBucket = res.body.trend.find((t: { date: string }) => t.date === today);
    // Both submissions in this suite (npsScore 8 in the previous test, 10 here)
    // land in today's bucket — the org is shared across the file.
    expect(todayBucket.responseCount).toBe(2);
    expect(todayBucket.avgNpsScore).toBe(9);
    const emptyBucket = res.body.trend.find((t: { responseCount: number }) => t.responseCount === 0);
    expect(emptyBucket.avgNpsScore).toBeNull();
  });

  it('cross-org isolation: org B president cannot view org A feedback analytics', async () => {
    const otherPresToken = await registerAndLogin(`anfb-iso-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AnFbIsoOrg', slug: `anfb-iso-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/feedback`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});

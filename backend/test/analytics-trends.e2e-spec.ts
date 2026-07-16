import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Analytics trends (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `an-tr-${Date.now()}@test.io`;
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
    prisma = moduleRef.get(PrismaService);
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AnTrOrg', slug: `an-tr-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Trends Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('zero-fills registrationTrend and reports a non-decreasing cumulative memberGrowth', async () => {
    const today = new Date().toISOString().slice(0, 10);

    // Two registrations today (the org's president is a member from setup;
    // these two participants are new active members too).
    const tokenA = await registerAndLogin(`tr-a-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${tokenA}`).send({}).expect(201);
    const tokenB = await registerAndLogin(`tr-b-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${tokenB}`).send({}).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/trends?days=7`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    expect(res.body.registrationTrend).toHaveLength(7);
    expect(res.body.memberGrowth).toHaveLength(7);
    const todayTrend = res.body.registrationTrend.find((r: { date: string }) => r.date === today);
    expect(todayTrend.count).toBe(2);
    // At least one earlier day in the window has zero registrations (zero-filled, not omitted).
    const earlierDay = res.body.registrationTrend[0];
    expect(earlierDay.count).toBe(0);

    // Member growth is non-decreasing across the window, and today's
    // cumulative count includes the president + both new participants.
    const counts = res.body.memberGrowth.map((g: { cumulativeActive: number }) => g.cumulativeActive);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
    expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(3);
  });

  it('defaults days to 30 when the query param is missing or invalid', async () => {
    const res1 = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/trends`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res1.body.registrationTrend).toHaveLength(30);

    const res2 = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/trends?days=not-a-number`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res2.body.registrationTrend).toHaveLength(30);
  });

  it('clamps days to the [1, 365] range', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/trends?days=9999`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.registrationTrend).toHaveLength(365);
  });

  it('cross-org isolation: org B president cannot view org A trends (403)', async () => {
    const otherPresToken = await registerAndLogin(`antr-other-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AnTrOtherOrg', slug: `an-tr-other-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/trends`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});

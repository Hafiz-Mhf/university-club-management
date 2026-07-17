import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CERTIFICATE_QUEUE, feedbackWindowCloseJobId } from '../src/certificates/generation/certificate-generation.types';

describe('Certificate release gating on Event Feedback + NPS (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: Queue;
  let presToken: string;
  let orgId: string;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    queue = moduleRef.get<Queue>(getQueueToken(CERTIFICATE_QUEUE));
    presToken = await registerAndLogin(`fbgate-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'FbGateOrg', slug: `fbgate-${Date.now()}` })).body.id;
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
    const email = `fbgate-p-${Date.now()}-${Math.random()}@test.io`;
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
    const user = await prisma.user.findUnique({ where: { email } });
    return { token, userId: user!.id };
  }

  const validFeedback = { npsScore: 9, contentRating: 5, organizationRating: 5, venueRating: 5 };

  async function waitForCertificates(eventId: string, count: number, timeoutMs = 8000) {
    const start = Date.now();
    for (;;) {
      const certs = await prisma.certificate.findMany({ where: { eventId, organizationId: orgId } });
      if (certs.length >= count) return certs;
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${count} certificate(s), have ${certs.length}`);
      await wait(200);
    }
  }

  it('a non-gated event still certs every PRESENT attendee immediately on complete (regression)', async () => {
    const eventId = await createPublishedEvent('Ungated Event');
    const { userId } = await presentParticipant(eventId);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const certs = await waitForCertificates(eventId, 1);
    expect(certs[0].userId).toBe(userId);
    expect(await queue.getJob(feedbackWindowCloseJobId(eventId))).toBeUndefined();
  });

  it('a gated event certs only attendees with feedback on complete, schedules a delayed catch-up job, and unlocks the rest on submit', async () => {
    const eventId = await createPublishedEvent('Gated Event');
    const { token: tokenA, userId: userA } = await presentParticipant(eventId);
    const { token: tokenB, userId: userB } = await presentParticipant(eventId);

    await request(app.getHttpServer()).patch(`/organizations/${orgId}/events/${eventId}`)
      .set('Authorization', `Bearer ${presToken}`).send({ requireFeedbackForCertificate: true }).expect(200);

    // userA submits feedback before the event is completed.
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${tokenA}`).send(validFeedback).expect(201);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    // Only userA (who already gave feedback) gets a certificate immediately.
    const certsAfterComplete = await waitForCertificates(eventId, 1);
    expect(certsAfterComplete.map((c) => c.userId)).toEqual([userA]);

    const windowJob = await queue.getJob(feedbackWindowCloseJobId(eventId));
    expect(windowJob).toBeDefined();
    expect(windowJob!.opts.delay).toBeGreaterThan(0);

    // userB submits feedback after completion — unlocked immediately, no 14-day wait.
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${tokenB}`).send(validFeedback).expect(201);

    const certsAfterUnlock = await waitForCertificates(eventId, 2);
    expect(certsAfterUnlock.map((c) => c.userId).sort()).toEqual([userA, userB].sort());
  });

  it('409s toggling requireFeedbackForCertificate once the event is COMPLETED', async () => {
    const eventId = await createPublishedEvent('Locked Toggle Event');
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    await request(app.getHttpServer()).patch(`/organizations/${orgId}/events/${eventId}`)
      .set('Authorization', `Bearer ${presToken}`).send({ requireFeedbackForCertificate: true }).expect(409);
  });
});

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Feedback submission (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
    prisma = moduleRef.get(PrismaService);
    presToken = await registerAndLogin(`fbsub-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'FbSubOrg', slug: `fbsub-${Date.now()}` })).body.id;
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
    const email = `fbsub-p-${Date.now()}-${Math.random()}@test.io`;
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

  const validFeedback = { npsScore: 9, contentRating: 5, organizationRating: 4, venueRating: 3, comment: 'Great event!' };

  it('a PRESENT attendee can submit feedback, and it is audited', async () => {
    const eventId = await createPublishedEvent('Feedback Event');
    const token = await presentParticipant(eventId);

    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send(validFeedback).expect(201);
    expect(res.body.npsScore).toBe(9);

    const auditRows = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/audit-logs`)
      .set('Authorization', `Bearer ${presToken}`)
      .query({ action: 'feedback.submit', pageSize: 100 });
    expect(auditRows.body.data.some((r: { targetId: string }) => r.targetId === res.body.id)).toBe(true);
  });

  it('/feedback/me 404s before submission and returns the row after', async () => {
    const eventId = await createPublishedEvent('Me Event');
    const token = await presentParticipant(eventId);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/feedback/me`)
      .set('Authorization', `Bearer ${token}`).expect(404);

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send(validFeedback).expect(201);

    const after = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/feedback/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(after.body.npsScore).toBe(9);
  });

  it('403s a registrant who was never marked PRESENT', async () => {
    const eventId = await createPublishedEvent('No Attendance Event');
    const email = `fbsub-np-${Date.now()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send(validFeedback).expect(403);
  });

  it('409s a second submission from the same attendee for the same event', async () => {
    const eventId = await createPublishedEvent('Duplicate Event');
    const token = await presentParticipant(eventId);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send(validFeedback).expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send(validFeedback).expect(409);
  });

  it('403s once the 14-day feedback window has closed', async () => {
    const eventId = await createPublishedEvent('Expired Window Event');
    const token = await presentParticipant(eventId);
    await prisma.event.update({
      where: { id: eventId },
      data: { endAt: new Date(Date.now() - 15 * 86400000) },
    });

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send(validFeedback).expect(403);
  });

  it('400s on an out-of-range npsScore', async () => {
    const eventId = await createPublishedEvent('Invalid Score Event');
    const token = await presentParticipant(eventId);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send({ ...validFeedback, npsScore: 11 }).expect(400);
  });

  it("cross-org isolation: org B member cannot submit feedback against org A's event", async () => {
    const otherToken = await registerAndLogin(`fbsub-iso-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'FbSubIsoOrg', slug: `fbsub-iso-${Date.now()}` }).expect(201);

    const eventId = await createPublishedEvent('Isolation Event');
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${otherToken}`).send(validFeedback).expect(403);
  });
});

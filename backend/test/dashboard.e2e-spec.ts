import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Dashboard summary (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
  const pdfBytes = () => Buffer.from('%PDF-1.4\n%mock certificate content\n');

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
  });
  afterAll(async () => { await app.close(); });

  describe('happy path', () => {
    let orgId: string;
    let presToken: string;
    let eventPubId: string;
    let participant1Id: string;
    let participant2Id: string;

    beforeAll(async () => {
      presToken = await registerAndLogin(`dash-pres-${Date.now()}@test.io`);
      orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
        .send({ name: 'DashOrg', slug: `dashorg-${Date.now()}` })).body.id;

      // DRAFT event — excluded from totalEvents and upcomingEvents
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ title: 'Draft Event', startAt: future(10), endAt: future(11) }).expect(201);

      // PUBLISHED event, capacity 1 — drives the WAITLISTED registration
      const eventPub = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ title: 'Published Event', startAt: future(5), endAt: future(6), capacity: 1 }).expect(201);
      eventPubId = eventPub.body.id;
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventPubId}/publish`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      // A second event, published then completed — counts toward totalEvents,
      // excluded from upcomingEvents once no longer PUBLISHED
      const eventCompleted = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ title: 'Completed Event', startAt: future(2), endAt: future(3) }).expect(201);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventCompleted.body.id}/publish`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventCompleted.body.id}/complete`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      const p1Email = `dash-p1-${Date.now()}@test.io`;
      const p1Token = await registerAndLogin(p1Email);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventPubId}/registrations`)
        .set('Authorization', `Bearer ${p1Token}`).send({}).expect(201);
      participant1Id = (await prisma.user.findUnique({ where: { email: p1Email } }))!.id;

      const p2Email = `dash-p2-${Date.now()}@test.io`;
      const p2Token = await registerAndLogin(p2Email);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventPubId}/registrations`)
        .set('Authorization', `Bearer ${p2Token}`).send({}).expect(201);
      participant2Id = (await prisma.user.findUnique({ where: { email: p2Email } }))!.id;

      // Mark participant1 PRESENT so a certificate can be issued to them
      const mine = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/events/${eventPubId}/attendance/me`)
        .set('Authorization', `Bearer ${p1Token}`).expect(200);
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventPubId}/attendance/scan`)
        .set('Authorization', `Bearer ${presToken}`).send({ token: mine.body.token }).expect(200);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventPubId}/certificates`)
        .set('Authorization', `Bearer ${presToken}`)
        .field('userId', participant1Id)
        .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
        .expect(201);

      // A fourth member, added then moved to ALUMNI — proves activeMembers
      // excludes non-ACTIVE members
      const alumniEmail = `dash-alumni-${Date.now()}@test.io`;
      await registerAndLogin(alumniEmail);
      const added = await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ email: alumniEmail, role: 'PARTICIPANT' }).expect(201);
      await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${added.body.id}`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ status: 'ALUMNI' }).expect(200);
    });

    it('returns exact KPI counts', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/dashboard`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(res.body.kpis).toEqual({
        activeMembers: 3, totalEvents: 2, activeRegistrations: 2, certificatesIssued: 1,
      });
    });

    it('upcomingEvents contains only the PUBLISHED future event, with a raw registration count', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/dashboard`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(res.body.upcomingEvents).toHaveLength(1);
      expect(res.body.upcomingEvents[0]).toMatchObject({
        id: eventPubId, title: 'Published Event', registrationCount: 2,
      });
    });

    it('pendingApprovals contains only the WAITLISTED registration', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/dashboard`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(res.body.pendingApprovals).toHaveLength(1);
      expect(res.body.pendingApprovals[0]).toMatchObject({
        eventId: eventPubId, eventTitle: 'Published Event', userId: participant2Id,
      });
    });

    it('recentRegistrations contains both registrations, newest first', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/dashboard`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(res.body.recentRegistrations).toHaveLength(2);
      expect(res.body.recentRegistrations[0].userId).toBe(participant2Id);
      expect(res.body.recentRegistrations[1].userId).toBe(participant1Id);
    });

    it('activityFeed reflects every audited action in this org, newest first', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/dashboard`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      // 12 audited actions occur in this org during setup: 3x event.create,
      // 2x event.publish, 1x event.complete, 2x registration.create,
      // 1x attendance.scan, 1x certificate.upload, 1x member.add,
      // 1x member.status.change. All fit under the top-15 limit.
      expect(res.body.activityFeed).toHaveLength(12);
      expect(res.body.activityFeed[0].action).toBe('member.status.change');
      const timestamps = res.body.activityFeed.map((a: { createdAt: string }) => new Date(a.createdAt).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeLessThanOrEqual(timestamps[i - 1]);
      }
    });

    it('a plain PARTICIPANT cannot view the dashboard (403)', async () => {
      const partToken = await registerAndLogin(`dash-part-${Date.now()}@test.io`);
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventPubId}/registrations`)
        .set('Authorization', `Bearer ${partToken}`).send({}).expect(201);

      await request(app.getHttpServer())
        .get(`/organizations/${orgId}/dashboard`)
        .set('Authorization', `Bearer ${partToken}`).expect(403);
    });
  });

  it('an org with just its president returns activeMembers:1, every other KPI 0, all arrays empty', async () => {
    const presToken = await registerAndLogin(`dash-empty-${Date.now()}@test.io`);
    const orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'EmptyDashOrg', slug: `emptydashorg-${Date.now()}` })).body.id;

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/dashboard`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    expect(res.body.kpis).toEqual({ activeMembers: 1, totalEvents: 0, activeRegistrations: 0, certificatesIssued: 0 });
    expect(res.body.upcomingEvents).toEqual([]);
    expect(res.body.pendingApprovals).toEqual([]);
    expect(res.body.recentRegistrations).toEqual([]);
    expect(res.body.activityFeed).toEqual([]);
  });

  it('cross-org isolation: org B committee cannot view org A dashboard (403)', async () => {
    const presAToken = await registerAndLogin(`dash-isoa-${Date.now()}@test.io`);
    const orgAId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presAToken}`)
      .send({ name: 'DashIsoA', slug: `dashisoa-${Date.now()}` })).body.id;

    const presBToken = await registerAndLogin(`dash-isob-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presBToken}`)
      .send({ name: 'DashIsoB', slug: `dashisob-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgAId}/dashboard`)
      .set('Authorization', `Bearer ${presBToken}`).expect(403);
  });
});

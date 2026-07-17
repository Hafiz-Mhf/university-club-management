import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Certificate auto-generation on event.complete (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
    presToken = await registerAndLogin(`certgen-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'CertGenOrg', slug: `certgen-${Date.now()}` })).body.id;
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
    const email = `certgen-p-${Date.now()}-${Math.random()}@test.io`;
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

  async function waitForCertificates(eventId: string, count: number, timeoutMs = 8000) {
    const start = Date.now();
    for (;;) {
      const certs = await prisma.certificate.findMany({ where: { eventId, organizationId: orgId } });
      if (certs.length >= count) return certs;
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${count} certificate(s), have ${certs.length}`);
      await wait(200);
    }
  }

  it('completing an event generates a certificate for each PRESENT attendee, audited', async () => {
    const eventId = await createPublishedEvent('Auto Cert Event');
    const { userId: userA } = await presentParticipant(eventId);
    const { userId: userB } = await presentParticipant(eventId);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const certs = await waitForCertificates(eventId, 2);
    expect(certs.map((c) => c.userId).sort()).toEqual([userA, userB].sort());

    const auditRows = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/audit-logs`)
      .set('Authorization', `Bearer ${presToken}`)
      .query({ action: 'certificate.generate', pageSize: 100 });
    const generatedIds = auditRows.body.data.map((r: { targetId: string }) => r.targetId);
    expect(certs.every((c) => generatedIds.includes(c.id))).toBe(true);
  });

  it('an attendee with a pre-existing manual upload is skipped by generation, and stays downloadable', async () => {
    const eventId = await createPublishedEvent('Mixed Cert Event');
    const { userId } = await presentParticipant(eventId);

    const uploadRes = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', Buffer.from('%PDF-1.4\n%manual\n'), { filename: 'manual.pdf', contentType: 'application/pdf' })
      .expect(201);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    // Give the (empty) generation queue a moment, then confirm exactly one
    // Certificate row exists — the manually-uploaded one, untouched.
    await wait(1000);
    const certs = await prisma.certificate.findMany({ where: { eventId, organizationId: orgId } });
    expect(certs).toHaveLength(1);
    expect(certs[0].id).toBe(uploadRes.body.id);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates/${uploadRes.body.id}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });

  it('a registrant who was never marked PRESENT gets no certificate', async () => {
    const eventId = await createPublishedEvent('No Attendance Event');
    const email = `certgen-np-${Date.now()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    await wait(1000);
    const certs = await prisma.certificate.findMany({ where: { eventId, organizationId: orgId } });
    expect(certs).toHaveLength(0);
  });

  it("tenant isolation: completing org A's event never generates a certificate referencing org B", async () => {
    const otherPresToken = await registerAndLogin(`certgen-iso-${Date.now()}@test.io`);
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'CertGenIsoOrg', slug: `certgen-iso-${Date.now()}` })).body.id;

    const eventId = await createPublishedEvent('Isolation Event');
    await presentParticipant(eventId);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await waitForCertificates(eventId, 1);

    const otherOrgCerts = await prisma.certificate.findMany({ where: { organizationId: otherOrgId } });
    expect(otherOrgCerts).toHaveLength(0);
  });
});

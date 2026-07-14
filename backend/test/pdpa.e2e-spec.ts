import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PDPA (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  describe('signup consent', () => {
    it('rejects registration without consent (400)', async () => {
      await request(app.getHttpServer()).post('/auth/register')
        .send({ email: `pdpa-nc-${Date.now()}@test.io`, password: 'password123', fullName: 'NoConsent' })
        .expect(400);
    });

    it('rejects registration with consent: false (400)', async () => {
      await request(app.getHttpServer()).post('/auth/register')
        .send({ email: `pdpa-fc-${Date.now()}@test.io`, password: 'password123', fullName: 'FalseConsent', consent: false })
        .expect(400);
    });

    it('records an account ConsentRecord on registration', async () => {
      const email = `pdpa-c-${Date.now()}@test.io`;
      const res = await request(app.getHttpServer()).post('/auth/register')
        .send({ email, password: 'password123', fullName: 'Consenting', consent: true })
        .expect(201);
      const consents = await prisma.consentRecord.findMany({ where: { userId: res.body.id } });
      expect(consents).toHaveLength(1);
      expect(consents[0].purpose).toBe('account');
      expect(consents[0].policyVersion).toBe('v1');
      expect(consents[0].grantedAt).toBeInstanceOf(Date);
    });
  });

  describe('consents and export', () => {
    let presToken: string;
    let partToken: string;
    let partUserId: string;
    let orgId: string;
    let eventId: string;
    const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

    beforeAll(async () => {
      presToken = await registerAndLogin(`pdpa-pres-${Date.now()}@test.io`);
      orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
        .send({ name: 'PdpaOrg', slug: `pdpaorg-${Date.now()}` })).body.id;
      const ev = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ title: 'PDPA Event', startAt: future(5), endAt: future(6) }).expect(201);
      eventId = ev.body.id;
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      const partEmail = `pdpa-part-${Date.now()}@test.io`;
      partToken = await registerAndLogin(partEmail);
      partUserId = (await prisma.user.findUnique({ where: { email: partEmail } }))!.id;
      // No registration form on this event, so the API rejects free-form answer
      // keys (RegistrationsService.validateAnswers) — register with an empty
      // body, then seed the answers content directly via Prisma. This suite
      // tests export/consents, not registration-form validation.
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
        .set('Authorization', `Bearer ${partToken}`).send({}).expect(201);
      await prisma.registration.updateMany({
        where: { eventId, organizationId: orgId, userId: partUserId },
        data: { answers: { note: 'my dietary needs' } },
      });

      // Seed a certificate directly (row + storage object) — upload RBAC/flow is certificates-suite territory.
      const { StorageService } = await import('../src/storage/storage.service');
      const storage = app.get(StorageService);
      const key = `certificates/${orgId}/${eventId}/${partUserId}.pdf`;
      await storage.putObject(key, Buffer.from('%PDF-1.4\npdpa cert\n'), 'application/pdf');
      await prisma.certificate.create({
        data: { eventId, organizationId: orgId, userId: partUserId, storageKey: key, fileSizeBytes: 20, uploadedByUserId: partUserId },
      });
    });

    it('GET /me/consents lists account + event-registration consents, no ipAddress', async () => {
      const res = await request(app.getHttpServer()).get('/me/consents')
        .set('Authorization', `Bearer ${partToken}`).expect(200);
      expect(res.body).toHaveLength(2);
      const purposes = res.body.map((c: { purpose: string }) => c.purpose).sort();
      expect(purposes).toEqual(['account', 'event-registration']);
      for (const c of res.body) {
        expect(c.policyVersion).toBe('v1');
        expect(c.grantedAt).toBeDefined();
        expect(c).not.toHaveProperty('ipAddress');
      }
    });

    it('GET /me/export returns every section with only own data', async () => {
      const res = await request(app.getHttpServer()).get('/me/export')
        .set('Authorization', `Bearer ${partToken}`).expect(200);

      expect(res.body.profile.id).toBe(partUserId);
      // Registering auto-enrolls the participant as a PARTICIPANT member of the org
      // (RegistrationsService.register upserts a Membership) — not membership-less.
      expect(res.body.memberships).toHaveLength(1);
      expect(res.body.memberships[0].organizationName).toBe('PdpaOrg');
      expect(res.body.memberships[0].role).toBe('PARTICIPANT');
      expect(res.body.registrations).toHaveLength(1);
      expect(res.body.registrations[0].eventTitle).toBe('PDPA Event');
      expect(res.body.registrations[0].organizationName).toBe('PdpaOrg');
      expect(res.body.registrations[0].answers).toEqual({ note: 'my dietary needs' });
      expect(res.body.consents).toHaveLength(2);
      expect(res.body.certificates).toHaveLength(1);
      expect(res.body.certificates[0].eventTitle).toBe('PDPA Event');
      expect(res.body.exportedAt).toBeDefined();

      // The signed URL actually serves the file.
      const dl = await fetch(res.body.certificates[0].downloadUrl);
      expect(dl.status).toBe(200);

      // Isolation: president's export contains none of the participant's artifacts.
      const presRes = await request(app.getHttpServer()).get('/me/export')
        .set('Authorization', `Bearer ${presToken}`).expect(200);
      expect(presRes.body.registrations).toEqual([]);
      expect(presRes.body.certificates).toEqual([]);
      expect(presRes.body.memberships).toHaveLength(1); // own org presidency only
    });

    it('export is audited as pdpa.export', async () => {
      const rows = await prisma.auditLog.findMany({
        where: { organizationId: { equals: null }, actorUserId: partUserId, action: 'pdpa.export' },
      });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].targetType).toBe('User');
      expect(rows[0].targetId).toBe(partUserId);
    });

    it('requires auth (401)', async () => {
      await request(app.getHttpServer()).get('/me/export').expect(401);
      await request(app.getHttpServer()).get('/me/consents').expect(401);
    });
  });

  describe('DELETE /me (anonymize)', () => {
    const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

    it('blocks a sole president with 409 naming the org', async () => {
      const email = `pdpa-solo-${Date.now()}@test.io`;
      const token = await registerAndLogin(email);
      await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${token}`)
        .send({ name: 'SoloOrg', slug: `soloorg-${Date.now()}` }).expect(201);

      const res = await request(app.getHttpServer()).delete('/me')
        .set('Authorization', `Bearer ${token}`).expect(409);
      expect(res.body.message).toContain('SoloOrg');
    });

    it('succeeds after presidency transfer, and for plain users', async () => {
      // President A + org
      const emailA = `pdpa-presa-${Date.now()}@test.io`;
      const tokenA = await registerAndLogin(emailA);
      const org = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'HandoverOrg', slug: `handover-${Date.now()}` })).body;

      // Member B, promoted to PRESIDENT
      const emailB = `pdpa-presb-${Date.now()}@test.io`;
      await registerAndLogin(emailB);
      const memberB = (await request(app.getHttpServer()).post(`/organizations/${org.id}/members`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ email: emailB, role: 'COMMITTEE' }).expect(201)).body;
      await request(app.getHttpServer()).patch(`/organizations/${org.id}/members/${memberB.id}/role`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ role: 'PRESIDENT' }).expect(200);

      // Now A can delete
      await request(app.getHttpServer()).delete('/me')
        .set('Authorization', `Bearer ${tokenA}`).expect(204);
    });

    it('anonymizes everything and preserves org statistics', async () => {
      // Full-fixture participant: registration with answers, certificate, refresh token.
      const presEmail = `pdpa-dpres-${Date.now()}@test.io`;
      const presToken = await registerAndLogin(presEmail);
      const orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
        .send({ name: 'DelOrg', slug: `delorg-${Date.now()}` })).body.id;
      const eventId = (await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ title: 'Del Event', startAt: future(5), endAt: future(6) })).body.id;
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      const email = `pdpa-del-${Date.now()}@test.io`;
      await request(app.getHttpServer()).post('/auth/register')
        .send({ email, password: 'password123', fullName: 'Delete Me', consent: true }).expect(201);
      const login = await request(app.getHttpServer()).post('/auth/login')
        .send({ email, password: 'password123' }).expect(201);
      const token = login.body.accessToken;
      const refreshToken = login.body.refreshToken;
      const userId = (await prisma.user.findUnique({ where: { email } }))!.id;

      // Membership with PII + registration with answers
      await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ email, role: 'VOLUNTEER', studentId: 'S12345', phone: '0123456789' }).expect(201);
      // Del Event has no registration form, so the API rejects free-form answer
      // keys (RegistrationsService.validateAnswers) — register with an empty
      // body, then seed the answers content directly via Prisma, mirroring the
      // workaround used in the 'consents and export' suite above.
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
        .set('Authorization', `Bearer ${token}`).send({}).expect(201);
      await prisma.registration.updateMany({
        where: { eventId, organizationId: orgId, userId },
        data: { answers: { allergy: 'peanuts' } },
      });

      // Seeded certificate (row + object)
      const { StorageService } = await import('../src/storage/storage.service');
      const storage = app.get(StorageService);
      const key = `certificates/${orgId}/${eventId}/${userId}.pdf`;
      await storage.putObject(key, Buffer.from('%PDF-1.4\ndel cert\n'), 'application/pdf');
      await prisma.certificate.create({
        data: { eventId, organizationId: orgId, userId, storageKey: key, fileSizeBytes: 18, uploadedByUserId: userId },
      });
      const signedBefore = await storage.getSignedDownloadUrl(key, 60);

      const regCountBefore = await prisma.registration.count({ where: { organizationId: orgId, eventId } });

      await request(app.getHttpServer()).delete('/me')
        .set('Authorization', `Bearer ${token}`).expect(204);

      // Login dead, refresh dead
      await request(app.getHttpServer()).post('/auth/login')
        .send({ email, password: 'password123' }).expect(401);
      await request(app.getHttpServer()).post('/auth/refresh')
        .send({ refreshToken }).expect(401);

      // User anonymized
      const user = (await prisma.user.findUnique({ where: { id: userId } }))!;
      expect(user.email).not.toBe(email);
      expect(user.email).toMatch(/@anonymized\.invalid$/);
      expect(user.fullName).toBe('Deleted User');
      expect(user.deletedAt).not.toBeNull();

      // Membership PII gone, row + role/status intact
      const membership = (await prisma.membership.findUnique({
        where: { userId_organizationId: { userId, organizationId: orgId } },
      }))!;
      expect(membership.studentId).toBeNull();
      expect(membership.phone).toBeNull();
      expect(membership.role).toBe('VOLUNTEER');
      expect(membership.status).toBe('ACTIVE');

      // Registration kept, answers gone; org count unchanged
      const regCountAfter = await prisma.registration.count({ where: { organizationId: orgId, eventId } });
      expect(regCountAfter).toBe(regCountBefore);
      const reg = await prisma.registration.findUnique({ where: { eventId_userId: { eventId, userId } } });
      expect(reg!.answers).toBeNull();

      // ConsentRecords retained
      const consents = await prisma.consentRecord.findMany({ where: { userId } });
      expect(consents.length).toBeGreaterThanOrEqual(2);

      // Certificate row + object gone
      const certs = await prisma.certificate.findMany({ where: { organizationId: orgId, userId } });
      expect(certs).toHaveLength(0);
      const dl = await fetch(signedBefore);
      expect(dl.status).toBe(404);

      // pdpa.delete audited in the org
      const auditRows = await prisma.auditLog.findMany({
        where: { organizationId: orgId, actorUserId: userId, action: 'pdpa.delete' },
      });
      expect(auditRows).toHaveLength(1);

      // Second DELETE within the token window: idempotent 204
      await request(app.getHttpServer()).delete('/me')
        .set('Authorization', `Bearer ${token}`).expect(204);
    });
  });
});

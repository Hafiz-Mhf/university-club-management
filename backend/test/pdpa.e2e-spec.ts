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

      // Seeded feedback response — the submit endpoint requires a completed
      // event plus PRESENT attendance inside the 14-day window, which is
      // feedback-suite territory; this suite only cares that export covers it.
      await prisma.feedbackResponse.create({
        data: {
          eventId, organizationId: orgId, userId: partUserId,
          npsScore: 9, contentRating: 5, organizationRating: 4, venueRating: 3,
          comment: 'venue was hard to find',
        },
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
      expect(res.body.feedback).toHaveLength(1);
      expect(res.body.feedback[0]).toMatchObject({
        eventTitle: 'PDPA Event',
        npsScore: 9,
        contentRating: 5,
        organizationRating: 4,
        venueRating: 3,
        comment: 'venue was hard to find',
      });
      expect(res.body.exportedAt).toBeDefined();

      // The signed URL actually serves the file.
      const dl = await fetch(res.body.certificates[0].downloadUrl);
      expect(dl.status).toBe(200);

      // Isolation: president's export contains none of the participant's artifacts.
      const presRes = await request(app.getHttpServer()).get('/me/export')
        .set('Authorization', `Bearer ${presToken}`).expect(200);
      expect(presRes.body.registrations).toEqual([]);
      expect(presRes.body.certificates).toEqual([]);
      expect(presRes.body.feedback).toEqual([]);
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

    it('succeeds after presidency is transferred to another member', async () => {
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

      await prisma.feedbackResponse.create({
        data: {
          eventId, organizationId: orgId, userId,
          npsScore: 8, contentRating: 4, organizationRating: 5, venueRating: 2,
          comment: 'the food had peanuts in it',
        },
      });

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

      // Feedback free-text scrubbed; ratings retained so org NPS/averages hold
      const feedback = (await prisma.feedbackResponse.findMany({ where: { organizationId: orgId, userId } }))[0];
      expect(feedback.comment).toBeNull();
      expect(feedback.npsScore).toBe(8);
      expect(feedback.venueRating).toBe(2);

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

    it('succeeds for a user who has downloaded their own certificate', async () => {
      // CertificateDownload.certificateId is ON DELETE RESTRICT, so the
      // download history has to be cleared before the certificate row.
      // The fixtures above seed certificates via Prisma and never call the
      // download endpoint, so they never create a CertificateDownload row —
      // this test goes through the real GET .../certificates/me path, which
      // every participant who has ever looked at their certificate has hit.
      const presEmail = `pdpa-dlpres-${Date.now()}@test.io`;
      const presToken = await registerAndLogin(presEmail);
      const orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
        .send({ name: 'DlOrg', slug: `dlorg-${Date.now()}` })).body.id;
      const eventId = (await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ title: 'Dl Event', startAt: future(5), endAt: future(6) })).body.id;
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      const email = `pdpa-dl-${Date.now()}@test.io`;
      const token = await registerAndLogin(email);
      const userId = (await prisma.user.findUnique({ where: { email } }))!.id;
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
        .set('Authorization', `Bearer ${token}`).send({}).expect(201);

      const { StorageService } = await import('../src/storage/storage.service');
      const storage = app.get(StorageService);
      const key = `certificates/${orgId}/${eventId}/${userId}.pdf`;
      await storage.putObject(key, Buffer.from('%PDF-1.4\ndl cert\n'), 'application/pdf');
      await prisma.certificate.create({
        data: { eventId, organizationId: orgId, userId, storageKey: key, fileSizeBytes: 17, uploadedByUserId: userId },
      });

      // The participant views their certificate — this writes the CertificateDownload row.
      await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${eventId}/certificates/me`)
        .set('Authorization', `Bearer ${token}`).expect(200);
      expect(await prisma.certificateDownload.count({ where: { userId } })).toBeGreaterThanOrEqual(1);

      await request(app.getHttpServer()).delete('/me')
        .set('Authorization', `Bearer ${token}`).expect(204);

      expect(await prisma.certificate.findMany({ where: { organizationId: orgId, userId } })).toHaveLength(0);
      expect(await prisma.certificateDownload.count({ where: { userId } })).toBe(0);
    });
  });

  describe('consent-versioned re-prompt', () => {
    it('a freshly registered user is never blocked', async () => {
      const email = `pdpa-fresh-${Date.now()}@test.io`;
      const token = await registerAndLogin(email);
      await request(app.getHttpServer()).get('/organizations')
        .set('Authorization', `Bearer ${token}`).expect(200);
    });

    it('blocks an authenticated request when the account consent is stale', async () => {
      const email = `pdpa-stale-${Date.now()}@test.io`;
      const token = await registerAndLogin(email);
      const user = await prisma.user.findUnique({ where: { email } });
      await prisma.consentRecord.updateMany({
        where: { userId: user!.id, purpose: 'account' },
        data: { policyVersion: 'v0-old' },
      });

      await request(app.getHttpServer()).get('/organizations')
        .set('Authorization', `Bearer ${token}`).expect(403);
    });

    it('PdpaController routes stay reachable while blocked', async () => {
      const email = `pdpa-blocked-pdpa-${Date.now()}@test.io`;
      const token = await registerAndLogin(email);
      const user = await prisma.user.findUnique({ where: { email } });
      await prisma.consentRecord.updateMany({
        where: { userId: user!.id, purpose: 'account' },
        data: { policyVersion: 'v0-old' },
      });

      await request(app.getHttpServer()).get('/me/consents')
        .set('Authorization', `Bearer ${token}`).expect(200);
      await request(app.getHttpServer()).get('/me/export')
        .set('Authorization', `Bearer ${token}`).expect(200);
    });

    it('POST /me/consent unblocks a stale user and audits pdpa.consent.renew', async () => {
      const email = `pdpa-renew-${Date.now()}@test.io`;
      const token = await registerAndLogin(email);
      const user = await prisma.user.findUnique({ where: { email } });
      await prisma.consentRecord.updateMany({
        where: { userId: user!.id, purpose: 'account' },
        data: { policyVersion: 'v0-old' },
      });
      await request(app.getHttpServer()).get('/organizations')
        .set('Authorization', `Bearer ${token}`).expect(403);

      const res = await request(app.getHttpServer()).post('/me/consent')
        .set('Authorization', `Bearer ${token}`).expect(201);
      expect(res.body.purpose).toBe('account');
      expect(res.body.policyVersion).toBe('v1');

      await request(app.getHttpServer()).get('/organizations')
        .set('Authorization', `Bearer ${token}`).expect(200);

      const auditRows = await prisma.auditLog.findMany({
        where: { organizationId: { equals: null }, actorUserId: user!.id, action: 'pdpa.consent.renew' },
      });
      expect(auditRows).toHaveLength(1);
    });

    it('login and refresh responses reflect consentStale', async () => {
      const email = `pdpa-flag-${Date.now()}@test.io`;
      await request(app.getHttpServer()).post('/auth/register')
        .send({ email, password: 'password123', fullName: email, consent: true });
      const freshLogin = await request(app.getHttpServer()).post('/auth/login')
        .send({ email, password: 'password123' }).expect(201);
      expect(freshLogin.body.consentStale).toBe(false);

      const user = await prisma.user.findUnique({ where: { email } });
      await prisma.consentRecord.updateMany({
        where: { userId: user!.id, purpose: 'account' },
        data: { policyVersion: 'v0-old' },
      });

      const staleLogin = await request(app.getHttpServer()).post('/auth/login')
        .send({ email, password: 'password123' }).expect(201);
      expect(staleLogin.body.consentStale).toBe(true);

      const refreshRes = await request(app.getHttpServer()).post('/auth/refresh')
        .send({ refreshToken: staleLogin.body.refreshToken }).expect(201);
      expect(refreshRes.body.consentStale).toBe(true);
    });
  });
});

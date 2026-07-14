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
});

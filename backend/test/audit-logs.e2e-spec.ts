import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Audit log query (e2e)', () => {
  let app: INestApplication;
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
  });
  afterAll(async () => { await app.close(); });

  describe('happy path', () => {
    let orgId: string;
    let presToken: string;
    let midpoint: string;

    beforeAll(async () => {
      presToken = await registerAndLogin(`audit-pres-${Date.now()}@test.io`);
      orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
        .send({ name: 'AuditOrg', slug: `auditorg-${Date.now()}` })).body.id;

      // Batch 1: event.create + event.publish
      const eventA = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ title: 'Event A', startAt: future(5), endAt: future(6) }).expect(201);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventA.body.id}/publish`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      await wait(50);
      midpoint = new Date().toISOString();
      await wait(50);

      // Batch 2: event.create + registration.create
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ title: 'Event B', startAt: future(5), endAt: future(6) }).expect(201);

      const partToken = await registerAndLogin(`audit-part-${Date.now()}@test.io`);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventA.body.id}/registrations`)
        .set('Authorization', `Bearer ${partToken}`).send({}).expect(201);

      // The registration asynchronously produces exactly 2 notification.email
      // audit rows (registration.approved -> registrant, registration.new ->
      // president, the org's only committee-tier member). Wait for both so
      // every assertion below sees a stable 6-row ledger.
      const deadline = Date.now() + 5000;
      for (;;) {
        const res = await request(app.getHttpServer())
          .get(`/organizations/${orgId}/audit-logs?action=notification.email`)
          .set('Authorization', `Bearer ${presToken}`);
        if (res.body.total === 2) break;
        if (Date.now() > deadline) throw new Error('Timed out waiting for notification.email audit rows');
        await wait(200);
      }
    });

    it('returns all 6 rows, newest first, with default pagination', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(res.body.total).toBe(6);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(25);
      expect(res.body.data).toHaveLength(6);
      // The 2 notification.email rows are written after registration.create,
      // so they lead the newest-first feed (their order between themselves is
      // nondeterministic — the queue worker sends them independently).
      expect(res.body.data[0].action).toBe('notification.email');
      expect(res.body.data[1].action).toBe('notification.email');
      expect(res.body.data[2].action).toBe('registration.create');
      expect(res.body.data[5].action).toBe('event.create');
      expect(res.body.data[0].metadata).not.toBeNull();
      expect(typeof res.body.data[0].metadata).toBe('object');
    });

    it('filters by action', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs?action=event.create`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((r: { action: string }) => r.action === 'event.create')).toBe(true);
    });

    it('filters by from/to date range', async () => {
      const afterRes = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs?from=${encodeURIComponent(midpoint)}`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);
      expect(afterRes.body.total).toBe(4);
      expect(afterRes.body.data.map((r: { action: string }) => r.action).sort()).toEqual(['event.create', 'notification.email', 'notification.email', 'registration.create']);

      const beforeRes = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs?to=${encodeURIComponent(midpoint)}`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);
      expect(beforeRes.body.total).toBe(2);
      expect(beforeRes.body.data.map((r: { action: string }) => r.action).sort()).toEqual(['event.create', 'event.publish']);
    });

    it('rejects an invalid "from" date with 400', async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs?from=not-a-date`)
        .set('Authorization', `Bearer ${presToken}`).expect(400);
    });

    it('paginates correctly across two pages with a small pageSize', async () => {
      const page1 = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs?page=1&pageSize=2`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);
      const page2 = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs?page=2&pageSize=2`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(page1.body.total).toBe(6);
      expect(page2.body.total).toBe(6);
      expect(page1.body.data).toHaveLength(2);
      expect(page2.body.data).toHaveLength(2);
      const page1Ids = page1.body.data.map((r: { id: string }) => r.id);
      const page2Ids = page2.body.data.map((r: { id: string }) => r.id);
      expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
    });

    it('a COMMITTEE-tier member cannot view the audit log (403)', async () => {
      const committeeEmail = `audit-committee-${Date.now()}@test.io`;
      const committeeToken = await registerAndLogin(committeeEmail);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ email: committeeEmail, role: 'COMMITTEE' }).expect(201);

      await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs`)
        .set('Authorization', `Bearer ${committeeToken}`).expect(403);
    });
  });

  it('cross-org isolation: org B president cannot view org A audit log (403)', async () => {
    const presAToken = await registerAndLogin(`audit-isoa-${Date.now()}@test.io`);
    const orgAId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presAToken}`)
      .send({ name: 'AuditIsoA', slug: `auditisoa-${Date.now()}` })).body.id;

    const presBToken = await registerAndLogin(`audit-isob-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presBToken}`)
      .send({ name: 'AuditIsoB', slug: `auditisob-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgAId}/audit-logs`)
      .set('Authorization', `Bearer ${presBToken}`).expect(403);
  });
});

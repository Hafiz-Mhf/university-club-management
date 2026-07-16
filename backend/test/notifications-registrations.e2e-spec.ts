import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Email notifications — registration triggers (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function auditRows() {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/audit-logs`)
      .set('Authorization', `Bearer ${presToken}`)
      .query({ action: 'notification.email', pageSize: 100 });
    return res.body.data as Array<{ targetId: string; metadata: { kind: string } }>;
  }

  async function waitForAuditRows(
    predicate: (rows: Array<{ targetId: string; metadata: { kind: string } }>) => boolean,
    timeoutMs = 5000,
  ) {
    const start = Date.now();
    for (;;) {
      const rows = await auditRows();
      if (predicate(rows)) return rows;
      if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for notification.email audit rows');
      await wait(200);
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`notif-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'NotifOrg', slug: `notif-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Notif Event', startAt: future(10), endAt: future(11), capacity: 1 });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('registering under capacity triggers a registration.approved email and a committee registration.new email', async () => {
    const token = await registerAndLogin(`notif-p1-${Date.now()}@test.io`);
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const registrationId = res.body.id;

    const rows = await waitForAuditRows((rows) =>
      rows.some((r) => r.targetId === registrationId && r.metadata.kind === 'registration.approved') &&
      rows.some((r) => r.targetId === registrationId && r.metadata.kind === 'registration.new'),
    );
    expect(rows.some((r) => r.targetId === registrationId && r.metadata.kind === 'registration.new')).toBe(true);
  });

  it('registering over capacity (waitlisted) triggers a registration.waitlisted email instead', async () => {
    const token = await registerAndLogin(`notif-p2-${Date.now()}@test.io`);
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    expect(res.body.status).toBe('WAITLISTED');
    const registrationId = res.body.id;

    await waitForAuditRows((rows) => rows.some((r) => r.targetId === registrationId && r.metadata.kind === 'registration.waitlisted'));
  });

  it('committee rejecting a registration triggers a registration.rejected email', async () => {
    const token = await registerAndLogin(`notif-p3-${Date.now()}@test.io`);
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const registrationId = res.body.id;

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${registrationId}/reject`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    await waitForAuditRows((rows) => rows.some((r) => r.targetId === registrationId && r.metadata.kind === 'registration.rejected'));
  });

  it('cancelling an APPROVED registration promotes the oldest WAITLISTED one and emails the promoted registrant', async () => {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Promote Event', startAt: future(10), endAt: future(11), capacity: 1 });
    const promoEventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${promoEventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const tokenA = await registerAndLogin(`notif-a-${Date.now()}@test.io`);
    const tokenB = await registerAndLogin(`notif-b-${Date.now()}@test.io`);
    const regA = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${promoEventId}/registrations`)
      .set('Authorization', `Bearer ${tokenA}`).send({}).expect(201);
    const regB = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${promoEventId}/registrations`)
      .set('Authorization', `Bearer ${tokenB}`).send({}).expect(201);
    expect(regB.body.status).toBe('WAITLISTED');

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${promoEventId}/registrations/${regA.body.id}/cancel`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200);

    await waitForAuditRows((rows) => rows.some((r) => r.targetId === regB.body.id && r.metadata.kind === 'registration.promoted'));
  });

  it("tenant isolation: org B's committee never receives a registration.new job for org A's registration", async () => {
    const otherPresToken = await registerAndLogin(`notif-iso-${Date.now()}@test.io`);
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'NotifIsoOrg', slug: `notif-iso-${Date.now()}` })).body.id;

    const token = await registerAndLogin(`notif-p4-${Date.now()}@test.io`);
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const registrationId = res.body.id;

    await waitForAuditRows((rows) => rows.some((r) => r.targetId === registrationId));

    const otherOrgRows = await request(app.getHttpServer())
      .get(`/organizations/${otherOrgId}/audit-logs`)
      .set('Authorization', `Bearer ${otherPresToken}`)
      .query({ action: 'notification.email', pageSize: 100 });
    expect(otherOrgRows.body.data.some((r: { targetId: string }) => r.targetId === registrationId)).toBe(false);
  });
});

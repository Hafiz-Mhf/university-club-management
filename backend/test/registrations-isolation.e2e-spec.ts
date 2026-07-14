import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Registrations tenant isolation (e2e)', () => {
  let app: INestApplication;
  let aToken: string;
  let aOrgId: string;
  let aEventId: string;
  let bToken: string;
  let bOrgId: string;
  let bEventId: string;
  let bRegistrationId: string;
  let bpToken: string;
  const a = `ria-${Date.now()}@test.io`;
  const b = `rib-${Date.now()}@test.io`;
  const bParticipant = `ribp-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function setupUserOrgEvent(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    const orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${token}`).send({ name: email.split('@')[0], slug: `${email.split('@')[0]}-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${token}`).send({ title: 'Iso Event', startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    return { token, orgId, eventId: event.body.id };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    const A = await setupUserOrgEvent(a);
    aToken = A.token; aOrgId = A.orgId; aEventId = A.eventId;
    const B = await setupUserOrgEvent(b);
    bToken = B.token; bOrgId = B.orgId; bEventId = B.eventId;

    await request(app.getHttpServer()).post('/auth/register').send({ email: bParticipant, password: 'password123', fullName: bParticipant, consent: true });
    bpToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: bParticipant, password: 'password123' })).body.accessToken;
    const reg = await request(app.getHttpServer())
      .post(`/organizations/${bOrgId}/events/${bEventId}/registrations`)
      .set('Authorization', `Bearer ${bpToken}`).send({}).expect(201);
    bRegistrationId = reg.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('A cannot list B registrations', () =>
    request(app.getHttpServer()).get(`/organizations/${bOrgId}/events/${bEventId}/registrations`)
      .set('Authorization', `Bearer ${aToken}`).expect(403));

  it("A cannot cancel a B registration via B's own org path", () =>
    request(app.getHttpServer()).post(`/organizations/${bOrgId}/events/${bEventId}/registrations/${bRegistrationId}/cancel`)
      .set('Authorization', `Bearer ${aToken}`).expect(403));

  it('A cannot reject a B registration', () =>
    request(app.getHttpServer()).post(`/organizations/${bOrgId}/events/${bEventId}/registrations/${bRegistrationId}/reject`)
      .set('Authorization', `Bearer ${aToken}`).expect(403));

  it("A cannot read B's registration form", () =>
    request(app.getHttpServer()).get(`/organizations/${bOrgId}/events/${bEventId}/registration-form`)
      .set('Authorization', `Bearer ${aToken}`).expect(403));

  it("A cannot write B's registration form", () =>
    request(app.getHttpServer()).put(`/organizations/${bOrgId}/events/${bEventId}/registration-form`)
      .set('Authorization', `Bearer ${aToken}`).send({ fields: [] }).expect(403));

  it("id-guessing: registering for B's event through A's own org path 404s", () =>
    request(app.getHttpServer()).post(`/organizations/${aOrgId}/events/${bEventId}/registrations`)
      .set('Authorization', `Bearer ${aToken}`).send({}).expect(404));

  it("id-guessing: rejecting B's registration through A's own org path 404s", () =>
    request(app.getHttpServer()).post(`/organizations/${aOrgId}/events/${aEventId}/registrations/${bRegistrationId}/reject`)
      .set('Authorization', `Bearer ${aToken}`).expect(404));

  it("id-guessing: PUT B's form through A's own org path (A org, B eventId) 404s", () =>
    request(app.getHttpServer()).put(`/organizations/${aOrgId}/events/${bEventId}/registration-form`)
      .set('Authorization', `Bearer ${aToken}`).send({ fields: [] }).expect(404));

  it("id-guessing: GET B's form through A's own org path (A org, B eventId) 404s", () =>
    request(app.getHttpServer()).get(`/organizations/${aOrgId}/events/${bEventId}/registration-form`)
      .set('Authorization', `Bearer ${aToken}`).expect(404));

  it("id-guessing: DELETE B's form through A's own org path (A org, B eventId) 404s", () =>
    request(app.getHttpServer()).delete(`/organizations/${aOrgId}/events/${bEventId}/registration-form`)
      .set('Authorization', `Bearer ${aToken}`).expect(404));

  it("id-guessing: listing B's event registrations through A's own org path returns empty array, not B's data", async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${aOrgId}/events/${bEventId}/registrations`)
      .set('Authorization', `Bearer ${aToken}`).expect(200);
    expect(res.body).toEqual([]);
  });

  it("id-guessing: rejecting B's registration through A's own org + B's eventId 404s, and B's registration is untouched", async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${aOrgId}/events/${bEventId}/registrations/${bRegistrationId}/reject`)
      .set('Authorization', `Bearer ${aToken}`).expect(404);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${bOrgId}/events/${bEventId}/registrations`)
      .set('Authorization', `Bearer ${bToken}`).expect(200);
    const found = res.body.find((r: { id: string }) => r.id === bRegistrationId);
    expect(found).toBeDefined();
    expect(found.status).toBe('APPROVED');
  });

  it("id-guessing: cancelling B's registration through A's own org + B's eventId 404s, and B's registration is untouched", async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${aOrgId}/events/${bEventId}/registrations/${bRegistrationId}/cancel`)
      .set('Authorization', `Bearer ${aToken}`).expect(404);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${bOrgId}/events/${bEventId}/registrations`)
      .set('Authorization', `Bearer ${bToken}`).expect(200);
    const found = res.body.find((r: { id: string }) => r.id === bRegistrationId);
    expect(found).toBeDefined();
    expect(found.status).toBe('APPROVED');
  });

  it('A (no membership in B) cannot read /me on a B event (403 from TenantGuard)', () =>
    request(app.getHttpServer()).get(`/organizations/${bOrgId}/events/${bEventId}/registrations/me`)
      .set('Authorization', `Bearer ${aToken}`).expect(403));

  it("id-guessing: B participant reads /me with another org's eventId — org-scoped lookup finds nothing (200, empty body)", async () => {
    // findMine is org-scoped (eventId + organizationId + userId): A's eventId
    // never matches inside org B, so the service returns null. Nest's default
    // reply path serializes a null return as an empty body with 200 — no
    // existence leak about A's event, and never B-org data for a foreign event.
    const res = await request(app.getHttpServer())
      .get(`/organizations/${bOrgId}/events/${aEventId}/registrations/me`)
      .set('Authorization', `Bearer ${bpToken}`).expect(200);
    expect(res.text).toBe('');
  });

  it("B's registration survives A's isolation attempts", async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${bOrgId}/events/${bEventId}/registrations`)
      .set('Authorization', `Bearer ${bToken}`).expect(200);
    const found = res.body.find((r: { id: string }) => r.id === bRegistrationId);
    expect(found).toBeDefined();
    expect(found.status).toBe('APPROVED');
  });
});

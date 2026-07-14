import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Events tenant isolation (e2e)', () => {
  let app: INestApplication;
  let aToken: string;
  let aOrgId: string;
  let bToken: string;
  let bOrgId: string;
  let bEventId: string;
  const a = `eia-${Date.now()}@test.io`;
  const b = `eib-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function setupUserOrg(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    const orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${token}`).send({ name: email.split('@')[0], slug: `${email.split('@')[0]}-${Date.now()}` })).body.id;
    return { token, orgId };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    const A = await setupUserOrg(a);
    const B = await setupUserOrg(b);
    aToken = A.token; aOrgId = A.orgId;
    bToken = B.token; bOrgId = B.orgId;
    bEventId = (await request(app.getHttpServer()).post(`/organizations/${bOrgId}/events`)
      .set('Authorization', `Bearer ${bToken}`).send({ title: 'B Private', startAt: future(2), endAt: future(3) })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('A cannot list B events', () =>
    request(app.getHttpServer()).get(`/organizations/${bOrgId}/events`)
      .set('Authorization', `Bearer ${aToken}`).expect(403));

  it('A cannot create in B', () =>
    request(app.getHttpServer()).post(`/organizations/${bOrgId}/events`)
      .set('Authorization', `Bearer ${aToken}`).send({ title: 'Intrude', startAt: future(2), endAt: future(3) }).expect(403));

  it('A cannot edit a B event', () =>
    request(app.getHttpServer()).patch(`/organizations/${bOrgId}/events/${bEventId}`)
      .set('Authorization', `Bearer ${aToken}`).send({ venue: 'X' }).expect(403));

  it('A cannot publish a B event', () =>
    request(app.getHttpServer()).post(`/organizations/${bOrgId}/events/${bEventId}/publish`)
      .set('Authorization', `Bearer ${aToken}`).expect(403));

  it('A cannot delete a B event', () =>
    request(app.getHttpServer()).delete(`/organizations/${bOrgId}/events/${bEventId}`)
      .set('Authorization', `Bearer ${aToken}`).expect(403));

  it("A cannot reach a B event through A's own org (id guessing) — read", () =>
    request(app.getHttpServer()).get(`/organizations/${aOrgId}/events/${bEventId}`)
      .set('Authorization', `Bearer ${aToken}`).expect(404));

  it("A cannot reach a B event through A's own org (id guessing) — edit", () =>
    request(app.getHttpServer()).patch(`/organizations/${aOrgId}/events/${bEventId}`)
      .set('Authorization', `Bearer ${aToken}`).send({ venue: 'X' }).expect(404));

  it("A cannot reach a B event through A's own org (id guessing) — delete", () =>
    request(app.getHttpServer()).delete(`/organizations/${aOrgId}/events/${bEventId}`)
      .set('Authorization', `Bearer ${aToken}`).expect(404));

  it("A cannot reach a B event through A's own org (id guessing) — publish", () =>
    request(app.getHttpServer()).post(`/organizations/${aOrgId}/events/${bEventId}/publish`)
      .set('Authorization', `Bearer ${aToken}`).expect(404));

  it("B's event survives A's id-guessing attempts", async () => {
    const res = await request(app.getHttpServer()).get(`/organizations/${bOrgId}/events/${bEventId}`)
      .set('Authorization', `Bearer ${bToken}`).expect(200);
    expect(res.body.id).toBe(bEventId);
  });
});

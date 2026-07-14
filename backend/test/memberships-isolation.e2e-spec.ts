import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Membership tenant isolation (e2e)', () => {
  let app: INestApplication;
  let aToken: string;
  let aOrgId: string;
  let bToken: string;
  let bOrgId: string;
  let bMemberId: string;
  const a = `ia-${Date.now()}@test.io`;
  const b = `ib-${Date.now()}@test.io`;

  async function setupUserOrg(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    const orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${token}`).send({ name: email, slug: `${email.split('@')[0]}-${Date.now()}` })).body.id;
    const memberId = (await request(app.getHttpServer()).get(`/organizations/${orgId}/members/me`).set('Authorization', `Bearer ${token}`)).body.id;
    return { token, orgId, memberId };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    const A = await setupUserOrg(a);
    const B = await setupUserOrg(b);
    aToken = A.token;
    aOrgId = A.orgId;
    bToken = B.token;
    bOrgId = B.orgId;
    bMemberId = B.memberId;
  });
  afterAll(async () => { await app.close(); });

  it('A cannot list B members', () =>
    request(app.getHttpServer()).get(`/organizations/${bOrgId}/members`)
      .set('Authorization', `Bearer ${aToken}`).expect(403));

  it('A cannot add to B', () =>
    request(app.getHttpServer()).post(`/organizations/${bOrgId}/members`)
      .set('Authorization', `Bearer ${aToken}`).send({ email: a, role: 'COMMITTEE' }).expect(403));

  it('A cannot change roles in B', () =>
    request(app.getHttpServer()).patch(`/organizations/${bOrgId}/members/${bMemberId}/role`)
      .set('Authorization', `Bearer ${aToken}`).send({ role: 'COMMITTEE' }).expect(403));

  it('A cannot remove from B', () =>
    request(app.getHttpServer()).delete(`/organizations/${bOrgId}/members/${bMemberId}`)
      .set('Authorization', `Bearer ${aToken}`).expect(403));

  it('A cannot update member profiles in B', () =>
    request(app.getHttpServer()).patch(`/organizations/${bOrgId}/members/${bMemberId}`)
      .set('Authorization', `Bearer ${aToken}`).send({ faculty: 'X' }).expect(403));

  it("A cannot reach a B membership through A's own org (id guessing) — update profile", () =>
    request(app.getHttpServer()).patch(`/organizations/${aOrgId}/members/${bMemberId}`)
      .set('Authorization', `Bearer ${aToken}`).send({ faculty: 'X' }).expect(404));

  it("A cannot reach a B membership through A's own org (id guessing) — change role", () =>
    request(app.getHttpServer()).patch(`/organizations/${aOrgId}/members/${bMemberId}/role`)
      .set('Authorization', `Bearer ${aToken}`).send({ role: 'COMMITTEE' }).expect(404));

  it("A cannot reach a B membership through A's own org (id guessing) — remove", () =>
    request(app.getHttpServer()).delete(`/organizations/${aOrgId}/members/${bMemberId}`)
      .set('Authorization', `Bearer ${aToken}`).expect(404));

  it("B's membership survives A's id-guessing attempts", async () => {
    const res = await request(app.getHttpServer()).get(`/organizations/${bOrgId}/members/me`)
      .set('Authorization', `Bearer ${bToken}`).expect(200);
    expect(res.body.id).toBe(bMemberId);
  });
});

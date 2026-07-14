import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Update member (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let memberId: string;
  const pres = `p-${Date.now()}@test.io`;
  const other = `o-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    for (const e of [pres, other]) {
      await request(app.getHttpServer()).post('/auth/register').send({ email: e, password: 'password123', fullName: e, consent: true });
    }
    presToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' })).body.accessToken;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'UpOrg', slug: `u-${Date.now()}` })).body.id;
    const added = await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: other, role: 'COMMITTEE' });
    memberId = added.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('updates profile fields', async () => {
    const res = await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${memberId}`)
      .set('Authorization', `Bearer ${presToken}`).send({ programme: 'BCS', intake: '2024' }).expect(200);
    expect(res.body.programme).toBe('BCS');
  });

  it('marks a member as ALUMNI', async () => {
    const res = await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${memberId}`)
      .set('Authorization', `Bearer ${presToken}`).send({ status: 'ALUMNI' }).expect(200);
    expect(res.body.status).toBe('ALUMNI');
  });

  it('404 for a membership id not in this org', async () => {
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${presToken}`).send({ programme: 'x' }).expect(404);
  });

  it('409 when marking the last active PRESIDENT as ALUMNI (guardrail)', async () => {
    const presMembershipId = (await request(app.getHttpServer())
      .get(`/organizations/${orgId}/members/me`)
      .set('Authorization', `Bearer ${presToken}`)).body.id;
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${presMembershipId}`)
      .set('Authorization', `Bearer ${presToken}`).send({ status: 'ALUMNI' }).expect(409);
  });

  it('ignores role/organizationId/userId in the body (mass-assignment guard)', async () => {
    const res = await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${memberId}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ role: 'PRESIDENT', organizationId: 'evil-org', userId: 'evil-user', faculty: 'FOE' })
      .expect(200);
    expect(res.body.role).toBe('COMMITTEE');
    expect(res.body.organizationId).toBe(orgId);
    expect(res.body.faculty).toBe('FOE');
  });
});

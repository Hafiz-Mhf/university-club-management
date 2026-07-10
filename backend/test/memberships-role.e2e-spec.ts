import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Change member role (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let presMembershipId: string;
  let otherId: string;
  const pres = `pr-${Date.now()}@test.io`;
  const other = `ot-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    for (const e of [pres, other]) {
      await request(app.getHttpServer()).post('/auth/register').send({ email: e, password: 'password123', fullName: e });
    }
    presToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' })).body.accessToken;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'RoleOrg', slug: `r-${Date.now()}` })).body.id;
    presMembershipId = (await request(app.getHttpServer()).get(`/organizations/${orgId}/members/me`).set('Authorization', `Bearer ${presToken}`)).body.id;
    otherId = (await request(app.getHttpServer()).post(`/organizations/${orgId}/members`).set('Authorization', `Bearer ${presToken}`).send({ email: other, role: 'COMMITTEE' })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('promotes a member to VICE_PRESIDENT and records history', async () => {
    const res = await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${otherId}/role`)
      .set('Authorization', `Bearer ${presToken}`).send({ role: 'VICE_PRESIDENT' }).expect(200);
    expect(res.body.role).toBe('VICE_PRESIDENT');
    expect(Array.isArray(res.body.committeeHistory)).toBe(true);
    expect(res.body.committeeHistory[0].role).toBe('COMMITTEE');
  });

  it('refuses to demote the last PRESIDENT', async () => {
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${presMembershipId}/role`)
      .set('Authorization', `Bearer ${presToken}`).send({ role: 'COMMITTEE' }).expect(409);
  });
});

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Remove member (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let presMembershipId: string;
  let otherId: string;
  const pres = `prm-${Date.now()}@test.io`;
  const other = `otm-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    for (const e of [pres, other]) {
      await request(app.getHttpServer()).post('/auth/register').send({ email: e, password: 'password123', fullName: e });
    }
    presToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' })).body.accessToken;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'RM', slug: `rm-${Date.now()}` })).body.id;
    presMembershipId = (await request(app.getHttpServer()).get(`/organizations/${orgId}/members/me`).set('Authorization', `Bearer ${presToken}`)).body.id;
    otherId = (await request(app.getHttpServer()).post(`/organizations/${orgId}/members`).set('Authorization', `Bearer ${presToken}`).send({ email: other, role: 'COMMITTEE' })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('removes a committee member', async () => {
    await request(app.getHttpServer()).delete(`/organizations/${orgId}/members/${otherId}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const list = await request(app.getHttpServer()).get(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`);
    expect(list.body.map((m: { id: string }) => m.id)).not.toContain(otherId);
  });

  it('refuses to remove the last PRESIDENT', async () => {
    await request(app.getHttpServer()).delete(`/organizations/${orgId}/members/${presMembershipId}`)
      .set('Authorization', `Bearer ${presToken}`).expect(409);
  });
});

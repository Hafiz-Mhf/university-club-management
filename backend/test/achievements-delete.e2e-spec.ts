import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Achievement delete (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createAchievement() {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Deletable', description: 'x', year: 2022 })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`achdel-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AchDelOrg', slug: `achdel-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee deletes an achievement, and it 404s on subsequent get', async () => {
    const id = await createAchievement();
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/achievements/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/achievements/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });

  it('a plain participant cannot delete (403)', async () => {
    const id = await createAchievement();
    const email = `achdel-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/achievements/${id}`)
      .set('Authorization', `Bearer ${memberToken}`).expect(403);
  });

  it('404 deleting an achievementId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AchDelOtherOrg', slug: `achdel-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Other Org Award', description: 'x', year: 2021 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/achievements/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(404);
  });
});

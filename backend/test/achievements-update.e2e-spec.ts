import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Achievement update (e2e)', () => {
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
      .send({ title: 'Original Title', description: 'Original Description', year: 2022 })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`achup-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AchUpOrg', slug: `achup-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('updates a subset of fields, leaving others untouched', async () => {
    const id = await createAchievement();
    const res = await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/achievements/${id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ year: 2023 })
      .expect(200);
    expect(res.body.year).toBe(2023);
    expect(res.body.title).toBe('Original Title');
    expect(res.body.description).toBe('Original Description');
  });

  it('a plain participant cannot edit (403)', async () => {
    const id = await createAchievement();
    const email = `achup-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/achievements/${id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ year: 1999 })
      .expect(403);
  });

  it('404 editing an achievementId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AchUpOtherOrg', slug: `achup-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Other Org Award', description: 'x', year: 2021 })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/achievements/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ year: 2000 })
      .expect(404);
  });
});

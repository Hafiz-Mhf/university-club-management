import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Achievement list + get (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createAchievement(title: string, year: number) {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title, description: 'desc', year })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`achlg-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AchLgOrg', slug: `achlg-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('lists achievements sorted by year descending', async () => {
    await createAchievement('Older Award', 2020);
    await createAchievement('Newer Award', 2025);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const titles = res.body.map((a: { title: string }) => a.title);
    expect(titles.indexOf('Newer Award')).toBeLessThan(titles.indexOf('Older Award'));
  });

  it('a plain participant can list (no RBAC restriction)', async () => {
    const email = `achlg-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${memberToken}`).expect(200);
  });

  it('get-one returns the full entry', async () => {
    const id = await createAchievement('Full Entry Award', 2023);
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/achievements/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.title).toBe('Full Entry Award');
    expect(res.body.year).toBe(2023);
  });

  it('404 getting an achievementId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AchLgOtherOrg', slug: `achlg-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Other Org Award', description: 'x', year: 2021 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/achievements/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });
});

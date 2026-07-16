import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Asset delete (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createAsset() {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Deletable', quantity: 1 })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`assetdel-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetDelOrg', slug: `assetdel-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee deletes an asset, and it 404s on subsequent get', async () => {
    const id = await createAsset();
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/assets/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/assets/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });

  it('a plain participant cannot delete (403)', async () => {
    const id = await createAsset();
    const email = `assetdel-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/assets/${id}`)
      .set('Authorization', `Bearer ${memberToken}`).expect(403);
  });

  it('404 deleting an assetId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetDelOtherOrg', slug: `assetdel-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Other Org Asset', quantity: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/assets/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(404);
  });
});

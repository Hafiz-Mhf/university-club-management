import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Asset update (e2e)', () => {
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
      .send({ name: 'Original Name', quantity: 10, location: 'Room A' })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`assetup-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetUpOrg', slug: `assetup-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('updates a subset of fields, leaving others untouched', async () => {
    const id = await createAsset();
    const res = await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/assets/${id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ condition: 'DAMAGED' })
      .expect(200);
    expect(res.body.condition).toBe('DAMAGED');
    expect(res.body.name).toBe('Original Name');
    expect(res.body.location).toBe('Room A');
  });

  it('a plain participant cannot edit (403)', async () => {
    const id = await createAsset();
    const email = `assetup-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/assets/${id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ quantity: 999 })
      .expect(403);
  });

  it('404 editing an assetId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetUpOtherOrg', slug: `assetup-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Other Org Asset', quantity: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/assets/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ quantity: 2 })
      .expect(404);
  });
});

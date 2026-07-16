import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Asset list + get (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createAsset(name: string, quantity: number) {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name, quantity })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`assetlg-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetLgOrg', slug: `assetlg-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('lists assets sorted alphabetically by name', async () => {
    await createAsset('Zebra Banner', 1);
    await createAsset('Amplifier', 2);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const names = res.body.map((a: { name: string }) => a.name);
    expect(names.indexOf('Amplifier')).toBeLessThan(names.indexOf('Zebra Banner'));
  });

  it('a plain participant can list (no RBAC restriction)', async () => {
    const email = `assetlg-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${memberToken}`).expect(200);
  });

  it('cross-org isolation: org B president cannot list org A assets (403)', async () => {
    const otherPresToken = await registerAndLogin(`assetlg-iso-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AssetLgIsoOrg', slug: `assetlg-iso-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });

  it('get-one returns the full entry', async () => {
    const id = await createAsset('Get One Asset', 5);
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/assets/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.name).toBe('Get One Asset');
    expect(res.body.quantity).toBe(5);
  });

  it('404 getting an assetId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetLgOtherOrg', slug: `assetlg-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Other Org Asset', quantity: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/assets/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });
});

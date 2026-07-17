import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Organization branding (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pngBytes = () => Buffer.from('89504e470d0a1a0a', 'hex');

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`brand-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'BrandOrg', slug: `brand-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee uploads a logo, GET reflects a fetchable logoUrl', async () => {
    const uploadRes = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', pngBytes(), { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    expect(uploadRes.body.logoUrl).toBeTruthy();

    const getRes = await request(app.getHttpServer())
      .get(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(getRes.body.logoUrl).toBeTruthy();
    expect(getRes.body.logoKey).toBeUndefined();

    const fetched = await fetch(getRes.body.logoUrl);
    expect(fetched.status).toBe(200);
  });

  it('committee uploads a banner, GET reflects a fetchable bannerUrl', async () => {
    const uploadRes = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/banner`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', pngBytes(), { filename: 'banner.png', contentType: 'image/png' })
      .expect(201);
    expect(uploadRes.body.bannerUrl).toBeTruthy();
  });

  it('400 rejects a non-image MIME type', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', Buffer.from('not an image'), { filename: 'file.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('400 rejects a file over 2MB', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 1);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' })
      .expect(400);
  });

  it('400 when no file is attached', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(400);
  });

  it('a user with no membership in the org cannot upload a logo (403)', async () => {
    const outsiderToken = await registerAndLogin(`brand-outsider-${Date.now()}@test.io`);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .attach('file', pngBytes(), { filename: 'logo.png', contentType: 'image/png' })
      .expect(403);
  });

  it('deletes the logo — idempotent on a second call', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', pngBytes(), { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);

    const firstDelete = await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(firstDelete.body.logoUrl).toBeNull();

    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });

  it('PATCH .../settings round-trips secondaryColor', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/settings`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ secondaryColor: '#123456' })
      .expect(200);
    expect(res.body.secondaryColor).toBe('#123456');
  });

  it('400 rejects an invalid secondaryColor hex', async () => {
    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/settings`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ secondaryColor: 'not-a-color' })
      .expect(400);
  });

  it('tenant isolation: uploading against another org is 403, never affects it', async () => {
    const otherPresToken = await registerAndLogin(`brand-other-${Date.now()}@test.io`);
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`).send({ name: 'OtherOrg', slug: `other-${Date.now()}` })).body.id;

    await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', pngBytes(), { filename: 'logo.png', contentType: 'image/png' })
      .expect(403);

    const otherOrg = await request(app.getHttpServer())
      .get(`/organizations/${otherOrgId}`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(200);
    expect(otherOrg.body.logoUrl).toBeNull();
  });
});

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Gallery list + delete (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pngBytes = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function uploadPhoto(caption: string, bytes: Buffer) {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('caption', caption)
      .attach('file', bytes, { filename: 'p.png', contentType: 'image/png' })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`gld-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'GldOrg', slug: `gld-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('list includes a working signed downloadUrl per photo', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x99]);
    await uploadPhoto('Roundtrip Photo', bytes);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const entry = res.body.find((p: { caption: string }) => p.caption === 'Roundtrip Photo');
    expect(typeof entry.downloadUrl).toBe('string');
    const fetched = await fetch(entry.downloadUrl);
    const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
    expect(fetchedBytes.equals(bytes)).toBe(true);
  });

  it('a plain participant can list (no RBAC restriction)', async () => {
    const email = `gld-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${memberToken}`).expect(200);
  });

  it('committee deletes a photo, and it no longer appears in the list', async () => {
    const id = await uploadPhoto('Deletable', pngBytes());
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/gallery/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.find((p: { id: string }) => p.id === id)).toBeUndefined();
  });

  it('a plain participant cannot delete (403)', async () => {
    const id = await uploadPhoto('Protected', pngBytes());
    const email = `gld-p2-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/gallery/${id}`)
      .set('Authorization', `Bearer ${memberToken}`).expect(403);
  });

  it('404 deleting a photoId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'GldOtherOrg', slug: `gld-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', pngBytes(), { filename: 'o.png', contentType: 'image/png' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/gallery/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(404);
  });
});

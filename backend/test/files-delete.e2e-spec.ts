import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('File delete (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `fdel-${Date.now()}@test.io`;
  const pdfBytes = () => Buffer.from('%PDF-1.4\n%mock sop content\n');

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function uploadFile() {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Deletable').field('category', 'OTHER')
      .attach('file', pdfBytes(), { filename: 'd.pdf', contentType: 'application/pdf' })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'FdelOrg', slug: `fdel-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee deletes a file, and it 404s on subsequent download', async () => {
    const fileId = await uploadFile();
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/files/${fileId}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/files/${fileId}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });

  it('a plain participant cannot delete (403)', async () => {
    const fileId = await uploadFile();
    const email = `fdel-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/files/${fileId}`)
      .set('Authorization', `Bearer ${memberToken}`).expect(403);
  });

  it('404 deleting a fileId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'FdelOtherOrg', slug: `fdel-other-${Date.now()}` })).body.id;
    const otherFileRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Other Org File').field('category', 'OTHER')
      .attach('file', pdfBytes(), { filename: 'o.pdf', contentType: 'application/pdf' }).expect(201);

    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/files/${otherFileRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });
});

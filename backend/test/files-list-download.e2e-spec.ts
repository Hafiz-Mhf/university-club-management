import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('File list + download (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `fld-${Date.now()}@test.io`;
  const pdfBytes = () => Buffer.from('%PDF-1.4\n%mock sop content\n');

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function uploadFile(title: string, category: string, bytes: Buffer) {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', title)
      .field('category', category)
      .attach('file', bytes, { filename: 'f.pdf', contentType: 'application/pdf' })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'FldOrg', slug: `fld-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('lists files without storageKey or a signed URL', async () => {
    await uploadFile('SOP One', 'SOP', pdfBytes());
    await uploadFile('Report One', 'REPORT', pdfBytes());

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0].storageKey).toBeUndefined();
    expect(res.body[0].downloadUrl).toBeUndefined();
  });

  it('filters by category', async () => {
    const orgId2 = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'FldOrg2', slug: `fld2-${Date.now()}` })).body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId2}/files`)
      .set('Authorization', `Bearer ${presToken}`).field('title', 'A').field('category', 'SOP')
      .attach('file', pdfBytes(), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId2}/files`)
      .set('Authorization', `Bearer ${presToken}`).field('title', 'B').field('category', 'REPORT')
      .attach('file', pdfBytes(), { filename: 'b.pdf', contentType: 'application/pdf' }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId2}/files?category=SOP`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].category).toBe('SOP');
  });

  it('an unrecognized category value returns the unfiltered list', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/files?category=NOT_REAL`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('a plain participant can list (no RBAC restriction)', async () => {
    const email = `fld-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${memberToken}`).expect(200);
  });

  it('download returns a signed URL that round-trips the original bytes', async () => {
    const bytes = Buffer.from('%PDF-1.4\n%download roundtrip bytes\n');
    const fileId = await uploadFile('Roundtrip', 'OTHER', bytes);
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/files/${fileId}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(typeof res.body.downloadUrl).toBe('string');
    const fetched = await fetch(res.body.downloadUrl);
    const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
    expect(fetchedBytes.equals(bytes)).toBe(true);
  });

  it('404 downloading a fileId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'FldOtherOrg', slug: `fld-other-${Date.now()}` })).body.id;
    const otherFileRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Other Org File').field('category', 'OTHER')
      .attach('file', pdfBytes(), { filename: 'o.pdf', contentType: 'application/pdf' }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/files/${otherFileRes.body.id}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });
});

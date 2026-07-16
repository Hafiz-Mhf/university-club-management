import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('File upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let presToken: string;
  let orgId: string;
  const pres = `file-${Date.now()}@test.io`;
  const pdfBytes = () => Buffer.from('%PDF-1.4\n%mock sop content\n');

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'FileOrg', slug: `file-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee uploads a PDF as an SOP', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Onboarding SOP')
      .field('category', 'SOP')
      .attach('file', pdfBytes(), { filename: 'onboarding.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(res.body.title).toBe('Onboarding SOP');
    expect(res.body.category).toBe('SOP');
    expect(res.body.organizationId).toBe(orgId);
    expect(res.body.mimeType).toBe('application/pdf');
    expect(res.body.originalFilename).toBe('onboarding.pdf');
  });

  it('a plain participant cannot upload (403)', async () => {
    const email = `fp-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .field('title', 'Sneaky Upload')
      .field('category', 'OTHER')
      .attach('file', pdfBytes(), { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(403);
  });

  it('400 when no file is attached', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'No File')
      .field('category', 'OTHER')
      .expect(400);
  });

  it('400 rejects an unsupported MIME type', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Bad Type')
      .field('category', 'OTHER')
      .attach('file', Buffer.from('not allowed'), { filename: 'x.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('400 rejects a file over 20MB', async () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 1);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Too Big')
      .field('category', 'OTHER')
      .attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' })
      .expect(400);
  });

  it('400 when the upload would exceed the org storage quota (summed across Certificate + OrgFile)', async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { storageQuotaMb: 0 } });
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Over Quota')
      .field('category', 'OTHER')
      .attach('file', pdfBytes(), { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(400);
    await prisma.organization.update({ where: { id: orgId }, data: { storageQuotaMb: 1024 } });
  });
});

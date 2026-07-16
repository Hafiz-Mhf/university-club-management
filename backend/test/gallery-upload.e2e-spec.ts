import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Gallery upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let presToken: string;
  let orgId: string;
  const pres = `gal-${Date.now()}@test.io`;
  const pngBytes = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'GalOrg', slug: `gal-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee member uploads a photo with a caption', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('caption', 'Annual Dinner 2025')
      .attach('file', pngBytes(), { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body.caption).toBe('Annual Dinner 2025');
    expect(res.body.organizationId).toBe(orgId);
  });

  it('a plain participant cannot upload (403)', async () => {
    const email = `galp-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pngBytes(), { filename: 'x.png', contentType: 'image/png' })
      .expect(403);
  });

  it('400 rejects an unsupported MIME type', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', Buffer.from('not an image'), { filename: 'x.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('400 rejects a file over 10MB', async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 1);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' })
      .expect(400);
  });

  it('400 when the upload would exceed the org storage quota (summed across Certificate + OrgFile + GalleryPhoto)', async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { storageQuotaMb: 0 } });
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', pngBytes(), { filename: 'x.png', contentType: 'image/png' })
      .expect(400);
    await prisma.organization.update({ where: { id: orgId }, data: { storageQuotaMb: 1024 } });
  });
});

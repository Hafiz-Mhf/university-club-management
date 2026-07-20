import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Public gallery + achievements (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let orgSlug: string;
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
    presToken = await registerAndLogin(`pubga-${Date.now()}@test.io`);
    orgSlug = `pubga-${Date.now()}`;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'PubGaOrg', slug: orgSlug })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('public gallery route returns photos with no Authorization header', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('caption', 'Public Photo')
      .attach('file', pngBytes(), { filename: 'p.png', contentType: 'image/png' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgSlug}/gallery`)
      .expect(200);
    expect(res.body.find((p: { caption: string }) => p.caption === 'Public Photo')).toBeDefined();
  });

  it('404 for a nonexistent slug on public gallery', async () => {
    await request(app.getHttpServer())
      .get('/public/organizations/this-slug-does-not-exist/gallery')
      .expect(404);
  });

  it('public achievements route returns achievements sorted by year, no Authorization header', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Public Award', description: 'x', year: 2025 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgSlug}/achievements`)
      .expect(200);
    expect(res.body.find((a: { title: string }) => a.title === 'Public Award')).toBeDefined();
  });

  it('404 for a nonexistent slug on public achievements', async () => {
    await request(app.getHttpServer())
      .get('/public/organizations/this-slug-does-not-exist/achievements')
      .expect(404);
  });
});

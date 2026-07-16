import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Public profile (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`pub-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'PubOrg', slug: `pub-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('returns the profile with no Authorization header at all', async () => {
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Draft Event', startAt: future(5), endAt: future(6) }).expect(201);

    const publishedEvent = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Published Event', startAt: future(10), endAt: future(11) }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${publishedEvent.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgId}/profile`)
      .expect(200);
    expect(res.body.name).toBe('PubOrg');
    expect(res.body.primaryColor).toBe('#2563eb');
    const titles = res.body.upcomingEvents.map((e: { title: string }) => e.title);
    expect(titles).toContain('Published Event');
    expect(titles).not.toContain('Draft Event');
    expect(res.body.storageQuotaMb).toBeUndefined();
    expect(res.body.settings).toBeUndefined();
  });

  it('404 for a nonexistent orgId', async () => {
    await request(app.getHttpServer())
      .get('/public/organizations/00000000-0000-0000-0000-000000000000/profile')
      .expect(404);
  });
});

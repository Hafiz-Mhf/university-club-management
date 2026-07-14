import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Organizations profile/list (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let orgId: string;
  const email = `org-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: 'Org Owner', consent: true });
    const login = await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' });
    token = login.body.accessToken;
    const org = await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', `Bearer ${token}`).send({ name: 'ACM', slug: `acm-${Date.now()}` });
    orgId = org.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('lists organizations the caller belongs to', async () => {
    const res = await request(app.getHttpServer()).get('/organizations')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.map((o: { id: string }) => o.id)).toContain(orgId);
  });

  it('updates the org profile as PRESIDENT', async () => {
    const res = await request(app.getHttpServer()).patch(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Computing society', advisors: ['Dr. Smith'] })
      .expect(200);
    expect(res.body.description).toBe('Computing society');
    expect(res.body.advisors).toEqual(['Dr. Smith']);
  });

  it('rejects an unknown field via DTO whitelist (no mass-assignment)', async () => {
    await request(app.getHttpServer()).patch(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ storageQuotaMb: 999999 })
      .expect(200);
    const fetched = await request(app.getHttpServer()).get(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(fetched.body.storageQuotaMb).toBe(1024); // unchanged default
  });
});

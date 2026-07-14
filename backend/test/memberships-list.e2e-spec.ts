import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Memberships list/me (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let orgId: string;
  const email = `mem-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: 'Pres', consent: true });
    const login = await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' });
    token = login.body.accessToken;
    const org = await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', `Bearer ${token}`).send({ name: 'Mem', slug: `m-${Date.now()}` });
    orgId = org.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('lists members (creator present as PRESIDENT)', async () => {
    const res = await request(app.getHttpServer()).get(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].role).toBe('PRESIDENT');
    expect(res.body[0].user.email).toBe(email);
  });

  it('returns my membership', async () => {
    const res = await request(app.getHttpServer()).get(`/organizations/${orgId}/members/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.role).toBe('PRESIDENT');
  });
});

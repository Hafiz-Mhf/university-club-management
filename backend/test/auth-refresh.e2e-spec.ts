import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth refresh/logout (e2e)', () => {
  let app: INestApplication;
  const email = `rf-${Date.now()}@test.io`;

  async function login() {
    const res = await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' });
    return res.body.refreshToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: 'RF' });
  });
  afterAll(async () => { await app.close(); });

  it('rotates: refresh returns a new pair and old token stops working', async () => {
    const oldRt = await login();
    const refreshed = await request(app.getHttpServer()).post('/auth/refresh')
      .send({ refreshToken: oldRt }).expect(201);
    expect(refreshed.body.accessToken).toBeDefined();
    expect(refreshed.body.refreshToken).toBeDefined();
    expect(refreshed.body.refreshToken).not.toBe(oldRt);
    // reuse of the rotated-away token is rejected
    await request(app.getHttpServer()).post('/auth/refresh')
      .send({ refreshToken: oldRt }).expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const rt = await login();
    await request(app.getHttpServer()).post('/auth/logout')
      .send({ refreshToken: rt }).expect(201);
    await request(app.getHttpServer()).post('/auth/refresh')
      .send({ refreshToken: rt }).expect(401);
  });
});

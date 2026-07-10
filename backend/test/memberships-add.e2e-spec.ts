import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Add member (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `pres-${Date.now()}@test.io`;
  const newbie = `new-${Date.now()}@test.io`;

  async function register(email: string) {
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email.split('@')[0] });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await register(pres);
    await register(newbie);
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' });
    presToken = login.body.accessToken;
    const org = await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', `Bearer ${presToken}`).send({ name: 'AddOrg', slug: `add-${Date.now()}` });
    orgId = org.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('adds an existing user as COMMITTEE', async () => {
    const res = await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ email: newbie, role: 'COMMITTEE', faculty: 'ICT' })
      .expect(201);
    expect(res.body.role).toBe('COMMITTEE');
    expect(res.body.faculty).toBe('ICT');
  });

  it('409 on adding the same user twice', async () => {
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ email: newbie, role: 'VOLUNTEER' })
      .expect(409);
  });

  it('404 when the email has no account', async () => {
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ email: `ghost-${Date.now()}@test.io`, role: 'VOLUNTEER' })
      .expect(404);
  });
});

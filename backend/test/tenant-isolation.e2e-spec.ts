import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;

  async function makeUserWithOrg(tag: string) {
    const email = `${tag}-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: tag, consent: true });
    const login = await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' });
    const token = login.body.accessToken;
    const org = await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: tag, slug: `${tag}-${Date.now()}` });
    return { token, orgId: org.body.id };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('org A member cannot read org B', async () => {
    const a = await makeUserWithOrg('orgA');
    const b = await makeUserWithOrg('orgB');
    // A reads own org: OK
    await request(app.getHttpServer()).get(`/organizations/${a.orgId}`)
      .set('Authorization', `Bearer ${a.token}`).expect(200);
    // A reads B's org: forbidden
    await request(app.getHttpServer()).get(`/organizations/${b.orgId}`)
      .set('Authorization', `Bearer ${a.token}`).expect(403);
  });
});

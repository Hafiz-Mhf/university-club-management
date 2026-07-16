import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Asset create (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `asset-${Date.now()}@test.io`;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetOrg', slug: `asset-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee member creates an asset with all fields', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Folding Chairs', quantity: 20, condition: 'GOOD', location: 'Storage Room B', notes: 'Bought 2025' })
      .expect(201);
    expect(res.body.name).toBe('Folding Chairs');
    expect(res.body.quantity).toBe(20);
    expect(res.body.condition).toBe('GOOD');
    expect(res.body.location).toBe('Storage Room B');
    expect(res.body.organizationId).toBe(orgId);
  });

  it('condition defaults to GOOD when omitted', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Projector', quantity: 1 })
      .expect(201);
    expect(res.body.condition).toBe('GOOD');
  });

  it('a plain participant cannot create an asset (403)', async () => {
    const email = `assetp-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sneaky Asset', quantity: 1 })
      .expect(403);
  });

  it('400 when name is missing', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ quantity: 1 })
      .expect(400);
  });

  it('400 when quantity is 0', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Zero Item', quantity: 0 })
      .expect(400);
  });
});

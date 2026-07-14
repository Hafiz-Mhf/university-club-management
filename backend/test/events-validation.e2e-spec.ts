import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Events validation (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `vp-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await request(app.getHttpServer()).post('/auth/register').send({ email: pres, password: 'password123', fullName: pres, consent: true });
    presToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' })).body.accessToken;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'ValOrg', slug: `val-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  const post = (body: object) =>
    request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send(body);

  it('400 on missing title', () => post({ startAt: future(2), endAt: future(3) }).expect(400));
  it('400 on title shorter than 2 chars', () => post({ title: 'A', startAt: future(2), endAt: future(3) }).expect(400));
  it('400 on capacity < 1', () => post({ title: 'CapZero', startAt: future(2), endAt: future(3), capacity: 0 }).expect(400));
  it('400 on non-ISO startAt', () => post({ title: 'BadDate', startAt: 'not-a-date', endAt: future(3) }).expect(400));
  it('201 on a valid minimal event', () => post({ title: 'Minimal', startAt: future(2), endAt: future(3) }).expect(201));
});

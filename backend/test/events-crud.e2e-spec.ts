import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Events CRUD (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let memberEmail: string;
  let memberToken: string;
  let draftId: string;
  const pres = `ep-${Date.now()}@test.io`;
  const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await request(app.getHttpServer()).post('/auth/register').send({ email: pres, password: 'password123', fullName: pres });
    presToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' })).body.accessToken;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'EvOrg', slug: `ev-${Date.now()}` })).body.id;

    // seed a plain member (VOLUNTEER) to test DRAFT hiding
    memberEmail = `em-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register').send({ email: memberEmail, password: 'password123', fullName: memberEmail });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: memberEmail, role: 'VOLUNTEER' });
    memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: memberEmail, password: 'password123' })).body.accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('creates an event in DRAFT', async () => {
    const res = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Orientation', venue: 'Hall A', startAt: future(7), endAt: future(8), capacity: 100 })
      .expect(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.title).toBe('Orientation');
    expect(res.body.capacity).toBe(100);
  });

  it('400 when endAt is not after startAt', async () => {
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Bad', startAt: future(8), endAt: future(7) })
      .expect(400);
  });

  it('manager sees a DRAFT in the list; non-manager does not', async () => {
    const created = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Secret Draft', startAt: future(10), endAt: future(11) }).expect(201);
    draftId = created.body.id;

    const asManager = await request(app.getHttpServer()).get(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(asManager.body.map((e: { id: string }) => e.id)).toContain(draftId);

    const asMember = await request(app.getHttpServer()).get(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${memberToken}`).expect(200);
    expect(asMember.body.map((e: { id: string }) => e.id)).not.toContain(draftId);
  });

  it('non-manager gets 404 reading a DRAFT by id', async () => {
    await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${draftId}`)
      .set('Authorization', `Bearer ${memberToken}`).expect(404);
    await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${draftId}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
});

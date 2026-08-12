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
    await request(app.getHttpServer()).post('/auth/register').send({ email: pres, password: 'password123', fullName: pres, consent: true });
    presToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' })).body.accessToken;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'EvOrg', slug: `ev-${Date.now()}` })).body.id;

    // seed a plain member (VOLUNTEER) to test DRAFT hiding
    memberEmail = `em-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register').send({ email: memberEmail, password: 'password123', fullName: memberEmail, consent: true });
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

  it('lists how full each event is, so the committee can triage without opening it', async () => {
    const created = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Counted Event', startAt: future(12), endAt: future(13), capacity: 1 }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${created.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    for (const suffix of ['a', 'b']) {
      const email = `cnt-${suffix}-${Date.now()}@test.io`;
      await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
      const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${created.body.id}/registrations`)
        .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    }

    const list = await request(app.getHttpServer()).get(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const row = list.body.find((e: { id: string }) => e.id === created.body.id);
    expect(row.approvedCount).toBe(1);
    expect(row.waitlistedCount).toBe(1);
    // No feedback yet — the picker needs a real 0, not undefined.
    expect(row.feedbackCount).toBe(0);
  });

  it('non-manager gets 404 reading a DRAFT by id', async () => {
    await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${draftId}`)
      .set('Authorization', `Bearer ${memberToken}`).expect(404);
    await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${draftId}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });

  it('edits a DRAFT event', async () => {
    const created = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Editable', startAt: future(5), endAt: future(6) }).expect(201);
    const res = await request(app.getHttpServer()).patch(`/organizations/${orgId}/events/${created.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).send({ venue: 'Room 12', title: 'Edited' }).expect(200);
    expect(res.body.venue).toBe('Room 12');
    expect(res.body.title).toBe('Edited');
  });

  it('400 when an edit would make endAt <= startAt', async () => {
    const created = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'DateEdit', startAt: future(5), endAt: future(6) }).expect(201);
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/events/${created.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).send({ endAt: future(4) }).expect(400);
  });

  it('ignores status/organizationId in the edit body (mass-assignment guard)', async () => {
    const created = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'MassAssign', startAt: future(5), endAt: future(6) }).expect(201);
    const res = await request(app.getHttpServer()).patch(`/organizations/${orgId}/events/${created.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).send({ status: 'PUBLISHED', organizationId: 'evil', venue: 'V' }).expect(200);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.organizationId).toBe(orgId);
    expect(res.body.venue).toBe('V');
  });

  it('400 when title is explicitly null', async () => {
    const created = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'NullTitle', startAt: future(5), endAt: future(6) }).expect(201);
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/events/${created.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: null }).expect(400);
  });

  it('404 editing an event id not in this org', async () => {
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/events/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${presToken}`).send({ venue: 'x' }).expect(404);
  });
});

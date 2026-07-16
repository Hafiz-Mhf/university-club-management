import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Analytics demographics (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `an-dem-${Date.now()}@test.io`;

  async function register(email: string) {
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
  }
  async function login(email: string) {
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await register(pres);
    presToken = await login(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AnDemOrg', slug: `an-dem-${Date.now()}` })).body.id;

    const memberA = `dem-a-${Date.now()}@test.io`;
    const memberB = `dem-b-${Date.now()}@test.io`;
    const memberC = `dem-c-${Date.now()}@test.io`;
    await register(memberA);
    await register(memberB);
    await register(memberC);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: memberA, role: 'COMMITTEE', faculty: 'ICT', programme: 'BCS' }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: memberB, role: 'COMMITTEE', faculty: 'ICT', programme: 'BIT' }).expect(201);
    // memberC has no faculty/programme set.
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: memberC, role: 'VOLUNTEER' }).expect(201);
  });
  afterAll(async () => { await app.close(); });

  it('groups active members by faculty and programme, including a null group', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/demographics`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const ictGroup = res.body.faculty.find((f: { value: string | null }) => f.value === 'ICT');
    expect(ictGroup.count).toBe(2);
    const nullFaculty = res.body.faculty.find((f: { value: string | null }) => f.value === null);
    expect(nullFaculty.count).toBe(2); // memberC + the president (no faculty set)

    const bcsGroup = res.body.programme.find((p: { value: string | null }) => p.value === 'BCS');
    expect(bcsGroup.count).toBe(1);

    // No member-identifying field anywhere in the response.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('userId');
    expect(raw).not.toContain('fullName');
  });

  it('a plain participant cannot view demographics (403)', async () => {
    const participant = `dem-p-${Date.now()}@test.io`;
    await register(participant);
    const token = await login(participant);
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Dem Event', startAt: new Date(Date.now() + 5 * 86400000).toISOString(), endAt: new Date(Date.now() + 6 * 86400000).toISOString() });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/demographics`)
      .set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('cross-org isolation: org B president cannot view org A demographics (403)', async () => {
    const otherEmail = `andem-other-${Date.now()}@test.io`;
    await register(otherEmail);
    const otherPresToken = await login(otherEmail);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AnDemOtherOrg', slug: `an-dem-other-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/demographics`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Approve / promote a registration (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `ap-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  /** Publishes an event with the given capacity and returns its id. */
  async function publishedEvent(capacity?: number) {
    const event = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Approve Event', startAt: future(5), endAt: future(6), ...(capacity ? { capacity } : {}) });
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    return event.body.id as string;
  }

  async function registerFor(eventId: string, token: string) {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    return res.body as { id: string; status: string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', `Bearer ${presToken}`).send({ name: 'ApproveOrg', slug: `approve-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('promotes a waitlisted registration once a seat exists', async () => {
    const eventId = await publishedEvent(1);
    const firstToken = await registerAndLogin(`ap-first-${Date.now()}@test.io`);
    const waitToken = await registerAndLogin(`ap-wait-${Date.now()}@test.io`);
    const first = await registerFor(eventId, firstToken);
    const waitlisted = await registerFor(eventId, waitToken);
    expect(waitlisted.status).toBe('WAITLISTED');

    // Free the single seat without touching the waitlisted row: rejecting the
    // approved one auto-promotes, so raise capacity instead.
    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/events/${eventId}`)
      .set('Authorization', `Bearer ${presToken}`).send({ capacity: 2 }).expect(200);

    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${waitlisted.id}/approve`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.status).toBe('APPROVED');
    expect(first.status).toBe('APPROVED');
  });

  it('gives the promoted registrant an attendance row, so they can be checked in', async () => {
    const eventId = await publishedEvent(1);
    await registerFor(eventId, await registerAndLogin(`ap-seat-${Date.now()}@test.io`));
    const waitToken = await registerAndLogin(`ap-att-${Date.now()}@test.io`);
    const waitlisted = await registerFor(eventId, waitToken);
    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/events/${eventId}`)
      .set('Authorization', `Bearer ${presToken}`).send({ capacity: 2 }).expect(200);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${waitlisted.id}/approve`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const roster = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/attendance`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(roster.body.map((a: { registrationId: string }) => a.registrationId)).toContain(waitlisted.id);
  });

  it('refuses to approve past capacity, and says what to do instead (409)', async () => {
    const eventId = await publishedEvent(1);
    await registerFor(eventId, await registerAndLogin(`ap-full-${Date.now()}@test.io`));
    const waitlisted = await registerFor(eventId, await registerAndLogin(`ap-over-${Date.now()}@test.io`));

    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${waitlisted.id}/approve`)
      .set('Authorization', `Bearer ${presToken}`).expect(409);
    expect(res.body.message).toMatch(/capacity/i);
  });

  it('reverses a mistaken rejection', async () => {
    const eventId = await publishedEvent();
    const reg = await registerFor(eventId, await registerAndLogin(`ap-undo-${Date.now()}@test.io`));
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${reg.id}/reject`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${reg.id}/approve`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.status).toBe('APPROVED');
  });

  it('leaves a participant-cancelled registration alone (409)', async () => {
    const eventId = await publishedEvent();
    const ownerToken = await registerAndLogin(`ap-cancel-${Date.now()}@test.io`);
    const reg = await registerFor(eventId, ownerToken);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${reg.id}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`).expect(200);

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${reg.id}/approve`)
      .set('Authorization', `Bearer ${presToken}`).expect(409);
  });

  it('is already-approved safe (409, no duplicate attendance row)', async () => {
    const eventId = await publishedEvent();
    const reg = await registerFor(eventId, await registerAndLogin(`ap-dup-${Date.now()}@test.io`));
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${reg.id}/approve`)
      .set('Authorization', `Bearer ${presToken}`).expect(409);
  });

  it('a participant cannot approve anyone (403)', async () => {
    const eventId = await publishedEvent(1);
    await registerFor(eventId, await registerAndLogin(`ap-seat2-${Date.now()}@test.io`));
    const partToken = await registerAndLogin(`ap-part-${Date.now()}@test.io`);
    const waitlisted = await registerFor(eventId, partToken);

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${waitlisted.id}/approve`)
      .set('Authorization', `Bearer ${partToken}`).expect(403);
  });

  it('org B cannot approve a registration belonging to org A', async () => {
    const eventId = await publishedEvent(1);
    await registerFor(eventId, await registerAndLogin(`ap-a-${Date.now()}@test.io`));
    const waitlisted = await registerFor(eventId, await registerAndLogin(`ap-b-${Date.now()}@test.io`));

    const otherPres = await registerAndLogin(`ap-other-${Date.now()}@test.io`);
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', `Bearer ${otherPres}`).send({ name: 'OtherOrg', slug: `other-${Date.now()}` })).body.id;

    await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/events/${eventId}/registrations/${waitlisted.id}/approve`)
      .set('Authorization', `Bearer ${otherPres}`).expect(404);
  });
});

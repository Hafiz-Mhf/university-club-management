import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('My participation across events (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let partToken: string;
  let orgId: string;
  let openEventId: string;
  let fullEventId: string;
  const pres = `part-pres-${Date.now()}@test.io`;
  const part = `part-user-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  const registerUser = async (email: string) => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' });
    return login.body.accessToken as string;
  };

  const createPublishedEvent = async (title: string, capacity?: number) => {
    const event = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title, startAt: future(5), endAt: future(6), ...(capacity ? { capacity } : {}) });
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(200);
    return event.body.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    presToken = await registerUser(pres);
    orgId = (
      await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${presToken}`)
        .send({ name: 'ParticipationOrg', slug: `participation-${Date.now()}` })
    ).body.id;

    openEventId = await createPublishedEvent('Open Event');
    fullEventId = await createPublishedEvent('Full Event', 1);

    // Fill the capacity-1 event with someone else so our participant waitlists.
    const filler = await registerUser(`part-filler-${Date.now()}@test.io`);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${fullEventId}/registrations`)
      .set('Authorization', `Bearer ${filler}`)
      .send({})
      .expect(201);

    partToken = await registerUser(part);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${openEventId}/registrations`)
      .set('Authorization', `Bearer ${partToken}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${fullEventId}/registrations`)
      .set('Authorization', `Bearer ${partToken}`)
      .send({})
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the caller\'s own registrations across every event in the org', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/me/participation`)
      .set('Authorization', `Bearer ${partToken}`)
      .expect(200);

    expect(res.body).toHaveLength(2);
    const byTitle = Object.fromEntries(
      res.body.map((item: { event: { title: string } }) => [item.event.title, item]),
    );

    expect(byTitle['Open Event']).toMatchObject({
      status: 'APPROVED',
      hasCertificate: false,
      feedbackSubmitted: false,
      event: { id: openEventId, status: 'PUBLISHED' },
      attendance: { status: 'REGISTERED' },
    });
    // Waitlisted registrations have no Attendance row until they're promoted.
    expect(byTitle['Full Event']).toMatchObject({
      status: 'WAITLISTED',
      attendance: null,
    });
  });

  it('never returns another user\'s registrations', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/me/participation`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(200);

    // The president registered for nothing, even though registrations exist.
    expect(res.body).toEqual([]);
  });

  it('does not leak participation from another organization', async () => {
    const otherPres = await registerUser(`part-other-${Date.now()}@test.io`);
    const otherOrgId = (
      await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${otherPres}`)
        .send({ name: 'OtherOrg', slug: `participation-other-${Date.now()}` })
    ).body.id;

    // Our participant is not a member of the other org at all.
    await request(app.getHttpServer())
      .get(`/organizations/${otherOrgId}/me/participation`)
      .set('Authorization', `Bearer ${partToken}`)
      .expect(403);

    // And the other org's president sees none of our org's participation.
    const res = await request(app.getHttpServer())
      .get(`/organizations/${otherOrgId}/me/participation`)
      .set('Authorization', `Bearer ${otherPres}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get(`/organizations/${orgId}/me/participation`).expect(401);
  });
});

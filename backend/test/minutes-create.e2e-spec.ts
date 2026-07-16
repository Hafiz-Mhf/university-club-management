import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Meeting minutes create (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let presMembershipId: string;
  const pres = `min-${Date.now()}@test.io`;

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
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinOrg', slug: `min-${Date.now()}` })).body.id;
    presMembershipId = (await request(app.getHttpServer()).get(`/organizations/${orgId}/members/me`)
      .set('Authorization', `Bearer ${presToken}`)).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee member creates a minutes entry', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({
        title: 'Weekly Committee Meeting',
        meetingDate: '2026-07-10T00:00:00.000Z',
        attendeeMembershipIds: [presMembershipId],
        agendaItems: [{ topic: 'Budget', notes: 'Reviewed Q3 spend' }],
        actionItems: [{ task: 'Book venue for next event', owner: 'Secretary' }],
      })
      .expect(201);
    expect(res.body.title).toBe('Weekly Committee Meeting');
    expect(res.body.organizationId).toBe(orgId);
    expect(res.body.attendeeMembershipIds).toEqual([presMembershipId]);
    expect(res.body.agendaItems).toEqual([{ topic: 'Budget', notes: 'Reviewed Q3 spend' }]);
    expect(res.body.actionItems).toEqual([{ task: 'Book venue for next event', owner: 'Secretary' }]);
  });

  it('a plain participant cannot create minutes (403)', async () => {
    const email = `minp-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Sneaky Minutes', meetingDate: '2026-07-10T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(403);
  });

  it('400 when an attendeeMembershipIds entry does not belong to this org', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({
        title: 'Bad Attendee',
        meetingDate: '2026-07-10T00:00:00.000Z',
        attendeeMembershipIds: ['00000000-0000-0000-0000-000000000000'],
        agendaItems: [], actionItems: [],
      })
      .expect(400);
  });

  it('400 when title is missing', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ meetingDate: '2026-07-10T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(400);
  });

  it('400 when meetingDate is unparseable', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Bad Date', meetingDate: 'not-a-date', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(400);
  });
});

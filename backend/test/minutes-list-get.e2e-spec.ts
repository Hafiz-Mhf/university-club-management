import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Meeting minutes list + get (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createMinutes(title: string, meetingDate: string) {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title, meetingDate, attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`minlg-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinLgOrg', slug: `minlg-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('lists entries sorted by meetingDate descending', async () => {
    await createMinutes('Older Meeting', '2026-01-01T00:00:00.000Z');
    await createMinutes('Newer Meeting', '2026-06-01T00:00:00.000Z');

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    const titles = res.body.data.map((m: { title: string }) => m.title);
    expect(titles.indexOf('Newer Meeting')).toBeLessThan(titles.indexOf('Older Meeting'));
  });

  it('paginates with page and pageSize', async () => {
    const orgId2 = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinLgOrg2', slug: `minlg2-${Date.now()}` })).body.id;
    const seed = (title: string, meetingDate: string) => request(app.getHttpServer())
      .post(`/organizations/${orgId2}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title, meetingDate, attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);
    await seed('M1', '2026-01-01T00:00:00.000Z');
    await seed('M2', '2026-01-02T00:00:00.000Z');
    await seed('M3', '2026-01-03T00:00:00.000Z');

    const page1 = await request(app.getHttpServer())
      .get(`/organizations/${orgId2}/minutes?page=1&pageSize=2`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const page2 = await request(app.getHttpServer())
      .get(`/organizations/${orgId2}/minutes?page=2&pageSize=2`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(page1.body.total).toBe(3);
    expect(page1.body.data).toHaveLength(2);
    expect(page2.body.data).toHaveLength(1);
  });

  it('a plain participant can list (no RBAC restriction)', async () => {
    const email = `minlg-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${memberToken}`).expect(200);
  });

  it('get-one returns the full entry including agenda and action items', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({
        title: 'Full Entry', meetingDate: '2026-03-01T00:00:00.000Z',
        attendeeMembershipIds: [],
        agendaItems: [{ topic: 'Topic A', notes: 'Notes A' }],
        actionItems: [{ task: 'Task A', owner: 'Someone' }],
      }).expect(201);

    const getRes = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/minutes/${res.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(getRes.body.agendaItems).toEqual([{ topic: 'Topic A', notes: 'Notes A' }]);
    expect(getRes.body.actionItems).toEqual([{ task: 'Task A', owner: 'Someone' }]);
  });

  it('404 getting a minutesId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinLgOtherOrg', slug: `minlg-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Other Org Minutes', meetingDate: '2026-01-01T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/minutes/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });

  it('cross-org isolation: org B president cannot list org A minutes (403)', async () => {
    const otherPresToken = await registerAndLogin(`minlg-iso-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'MinLgIsoOrg', slug: `minlg-iso-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Meeting minutes delete (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createMinutes() {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Deletable', meetingDate: '2026-02-01T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`mindel-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinDelOrg', slug: `mindel-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee deletes a minutes entry, and it 404s on subsequent get', async () => {
    const id = await createMinutes();
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/minutes/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/minutes/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });

  it('a plain participant cannot delete (403)', async () => {
    const id = await createMinutes();
    const email = `mindel-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/minutes/${id}`)
      .set('Authorization', `Bearer ${memberToken}`).expect(403);
  });

  it('404 deleting a minutesId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinDelOtherOrg', slug: `mindel-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Other Org Minutes', meetingDate: '2026-01-01T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/minutes/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(404);
  });
});

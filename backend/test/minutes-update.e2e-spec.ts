import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Meeting minutes update (e2e)', () => {
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
      .send({
        title: 'Original Title', meetingDate: '2026-02-01T00:00:00.000Z',
        attendeeMembershipIds: [], agendaItems: [{ topic: 'A', notes: 'B' }], actionItems: [],
      }).expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`minup-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinUpOrg', slug: `minup-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('updates a subset of fields, leaving others untouched', async () => {
    const id = await createMinutes();
    const res = await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/minutes/${id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Updated Title' })
      .expect(200);
    expect(res.body.title).toBe('Updated Title');
    expect(res.body.agendaItems).toEqual([{ topic: 'A', notes: 'B' }]);
  });

  it('400 when an updated attendeeMembershipIds entry does not belong to this org', async () => {
    const id = await createMinutes();
    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/minutes/${id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ attendeeMembershipIds: ['00000000-0000-0000-0000-000000000000'] })
      .expect(400);
  });

  it('a plain participant cannot edit (403)', async () => {
    const id = await createMinutes();
    const email = `minup-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/minutes/${id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ title: 'Sneaky Edit' })
      .expect(403);
  });

  it('404 editing a minutesId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinUpOtherOrg', slug: `minup-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Other Org Minutes', meetingDate: '2026-01-01T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/minutes/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Should Not Work' })
      .expect(404);
  });
});

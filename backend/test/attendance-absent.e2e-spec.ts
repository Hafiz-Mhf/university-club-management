import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Attendance mark-absent (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `ab-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AbsOrg', slug: `ab-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Absent Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  async function registerParticipant() {
    const token = await registerAndLogin(`ap-${Date.now()}-${Math.random()}@test.io`);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const mine = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    return { token, attendanceId: mine.body.id as string, attendanceToken: mine.body.token as string };
  }

  it('MANAGE_ATTENDANCE holder marks a no-show absent', async () => {
    const { attendanceId } = await registerParticipant();
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/${attendanceId}/absent`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.status).toBe('ABSENT');
  });

  it('409 marking absent someone already scanned present', async () => {
    const { attendanceId, attendanceToken } = await registerParticipant();
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: attendanceToken }).expect(200);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/${attendanceId}/absent`)
      .set('Authorization', `Bearer ${presToken}`).expect(409);
  });

  it('a plain participant cannot mark someone absent (403)', async () => {
    const { attendanceId } = await registerParticipant();
    const strangerToken = await registerAndLogin(`stranger-${Date.now()}@test.io`);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/${attendanceId}/absent`)
      .set('Authorization', `Bearer ${strangerToken}`).expect(403);
  });

  it('404 marking absent an attendance id from a different event', async () => {
    const otherEvent = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Other Absent Event', startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${otherEvent.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const { attendanceId } = await registerParticipant(); // belongs to `eventId`, not `otherEvent`
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${otherEvent.body.id}/attendance/${attendanceId}/absent`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });
});

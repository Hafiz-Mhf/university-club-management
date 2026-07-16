import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { NOTIFICATION_QUEUE, reminderJobId } from '../src/notifications/notifications.types';

describe('Email notifications — event reminders (e2e)', () => {
  let app: INestApplication;
  let queue: Queue;
  let presToken: string;
  let orgId: string;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    queue = moduleRef.get<Queue>(getQueueToken(NOTIFICATION_QUEUE));
    presToken = await registerAndLogin(`notifrem-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'NotifRemOrg', slug: `notifrem-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('publishing an event >24h out schedules a delayed event.reminder job', async () => {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Far Event', startAt: future(10), endAt: future(11) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const job = await queue.getJob(reminderJobId(event.body.id));
    expect(job).toBeDefined();
    expect(job!.opts.delay).toBeGreaterThan(0);
  });

  it('publishing an event <24h out does not schedule a reminder', async () => {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({
        title: 'Soon Event',
        startAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const job = await queue.getJob(reminderJobId(event.body.id));
    expect(job).toBeUndefined();
  });

  it("updating a PUBLISHED event's startAt reschedules the reminder job", async () => {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Reschedule Event', startAt: future(10), endAt: future(11) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const before = await queue.getJob(reminderJobId(event.body.id));
    const originalDelay = before!.opts.delay!;

    await request(app.getHttpServer()).patch(`/organizations/${orgId}/events/${event.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).send({ startAt: future(20), endAt: future(21) }).expect(200);

    const after = await queue.getJob(reminderJobId(event.body.id));
    expect(after).toBeDefined();
    expect(after!.opts.delay).toBeGreaterThan(originalDelay);
  });

  it('cancelling a PUBLISHED event with a pending reminder removes the job', async () => {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Cancel Event', startAt: future(10), endAt: future(11) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(await queue.getJob(reminderJobId(event.body.id))).toBeDefined();

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/cancel`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    expect(await queue.getJob(reminderJobId(event.body.id))).toBeUndefined();
  });
});

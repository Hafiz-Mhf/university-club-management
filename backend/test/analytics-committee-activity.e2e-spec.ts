import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Analytics committee activity (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `an-ca-${Date.now()}@test.io`;
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
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AnCaOrg', slug: `an-ca-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('ranks committee members by audit action count, descending, excluding members with zero activity', async () => {
    // President creates 2 events (2 audited event.create actions, attributed to the president).
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'CA Event 1', startAt: future(5), endAt: future(6) }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'CA Event 2', startAt: future(5), endAt: future(6) }).expect(201);

    // A second committee member creates 1 event. Adding them is itself an
    // audited `member.add` action — attributed to the CALLER (the
    // president), not the target — so this also adds 1 to the president's
    // count, not the new member's.
    const committeeEmail = `ca-committee-${Date.now()}@test.io`;
    const committeeToken = await registerAndLogin(committeeEmail);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: committeeEmail, role: 'COMMITTEE' }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${committeeToken}`).send({ title: 'CA Event 3', startAt: future(5), endAt: future(6) }).expect(201);

    // A third committee member joins but performs no action of their own —
    // adding them is again attributed to the president, not to them.
    const idleEmail = `ca-idle-${Date.now()}@test.io`;
    await registerAndLogin(idleEmail);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: idleEmail, role: 'COMMITTEE' }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/committee-activity`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    expect(res.body.data.length).toBe(2); // president + the active committee member; idle member excluded (zero actions attributed to them)
    expect(res.body.data[0].actionCount).toBeGreaterThanOrEqual(res.body.data[1].actionCount);
    const presEntry = res.body.data.find((d: { role: string }) => d.role === 'PRESIDENT');
    // 2 event.create + 2 member.add (adding committeeEmail, then idleEmail).
    expect(presEntry.actionCount).toBe(4);
    const committeeEntry = res.body.data.find((d: { role: string }) => d.role === 'COMMITTEE');
    expect(committeeEntry.actionCount).toBe(1);
    expect(res.body.data.some((d: { userId: string }) => d.userId === undefined)).toBe(false);
  });

  it('cross-org isolation: org B president cannot view org A committee activity (403)', async () => {
    const otherPresToken = await registerAndLogin(`anca-other-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AnCaOtherOrg', slug: `an-ca-other-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/committee-activity`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Concurrency probe (temporary, not part of suite)', () => {
  let app: INestApplication;
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
    presToken = await registerAndLogin(`probe-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'ProbeOrg', slug: `probe-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('stress: N trials of two concurrent cancels racing to promote one waitlisted reg', async () => {
    const N = 25;
    let conflicts409 = 0;
    let overshoots = 0;
    for (let i = 0; i < N; i++) {
      const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`).send({ title: `Probe ${i}`, startAt: future(5), endAt: future(6), capacity: 2 });
      const eventId = event.body.id;
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      const register = (token: string) => request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventId}/registrations`)
        .set('Authorization', `Bearer ${token}`).send({});

      const t1 = await registerAndLogin(`p1-${i}-${Date.now()}@test.io`);
      const r1 = await register(t1);
      const t2 = await registerAndLogin(`p2-${i}-${Date.now()}@test.io`);
      const r2 = await register(t2);
      const t3 = await registerAndLogin(`p3-${i}-${Date.now()}@test.io`);
      const r3 = await register(t3);
      expect(r1.body.status).toBe('APPROVED');
      expect(r2.body.status).toBe('APPROVED');
      expect(r3.body.status).toBe('WAITLISTED');

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/organizations/${orgId}/events/${eventId}/registrations/${r1.body.id}/cancel`)
          .set('Authorization', `Bearer ${t1}`),
        request(app.getHttpServer())
          .post(`/organizations/${orgId}/events/${eventId}/registrations/${r2.body.id}/cancel`)
          .set('Authorization', `Bearer ${t2}`),
      ]);

      if (res1.status === 409 || res2.status === 409) {
        conflicts409++;
        // eslint-disable-next-line no-console
        console.log(`trial ${i}: 409 observed`, 'res1=', res1.status, res1.body, 'res2=', res2.status, res2.body);
      }

      const list = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/events/${eventId}/registrations`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);
      const approvedCount = list.body.filter((r: any) => r.status === 'APPROVED').length;
      if (approvedCount > 2) {
        overshoots++;
        // eslint-disable-next-line no-console
        console.log(`trial ${i}: OVERSHOOT approvedCount=${approvedCount}`, JSON.stringify(list.body));
      }
    }
    // eslint-disable-next-line no-console
    console.log(`SUMMARY over ${N} trials: 409-on-legit-cancel=${conflicts409}, overshoots=${overshoots}`);
    expect(overshoots).toBe(0);
  }, 120000);
});

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Analytics certificates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `an-cert-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
  const pdfBytes = () => Buffer.from('%PDF-1.4\n%mock certificate content\n');

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AnCertOrg', slug: `an-cert-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Cert Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  async function presentParticipant() {
    const email = `pp-${Date.now()}-${Math.random()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const mine = await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: mine.body.token }).expect(200);
    const user = await prisma.user.findUnique({ where: { email } });
    return { token, userId: user!.id };
  }

  it('counts issued certificates and total download activity (repeats count)', async () => {
    const { userId } = await presentParticipant();
    const upload = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(201);
    const certId = upload.body.id;

    // Two committee downloads of the same certificate.
    await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${eventId}/certificates/${certId}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${eventId}/certificates/${certId}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/certificates`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.issued).toBe(1);
    expect(res.body.downloaded).toBe(2);
  });

  it('cross-org isolation: org B president cannot view org A certificate analytics (403)', async () => {
    const otherPresToken = await registerAndLogin(`ancert-other-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AnCertOtherOrg', slug: `an-cert-other-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/certificates`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});

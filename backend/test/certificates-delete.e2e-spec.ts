import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Certificate delete (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `certdel-${Date.now()}@test.io`;
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
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'CertDelOrg', slug: `certdel-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'CertDel Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  async function presentParticipantWithCertificate() {
    const email = `pp-${Date.now()}-${Math.random()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const mine = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: mine.body.token }).expect(200);
    const user = await prisma.user.findUnique({ where: { email } });
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', user!.id)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(201);
    const list = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const certId = list.body.find((c: { userId: string }) => c.userId === user!.id).id;
    return { token, userId: user!.id, certId };
  }

  it('committee deletes a certificate; the file is gone and /me subsequently 404s', async () => {
    const { token, certId } = await presentParticipantWithCertificate();
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/events/${eventId}/certificates/${certId}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates/me`)
      .set('Authorization', `Bearer ${token}`).expect(404);
  });

  it('a plain participant cannot delete (403)', async () => {
    const { certId } = await presentParticipantWithCertificate();
    const { token: strangerToken } = await (async () => {
      const email = `stranger-${Date.now()}@test.io`;
      const token = await registerAndLogin(email);
      return { token };
    })();
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/events/${eventId}/certificates/${certId}`)
      .set('Authorization', `Bearer ${strangerToken}`).expect(403);
  });

  it('404 deleting a certificateId that does not exist', async () => {
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/events/${eventId}/certificates/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });

  it('404 re-deleting an already-deleted certificate', async () => {
    const { certId } = await presentParticipantWithCertificate();
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/events/${eventId}/certificates/${certId}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/events/${eventId}/certificates/${certId}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });
});

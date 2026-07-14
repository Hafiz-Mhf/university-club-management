// backend/test/certificates-isolation.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Certificate cross-org isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let presAToken: string;
  let presBToken: string;
  let orgAId: string;
  let orgBId: string;
  let eventAId: string;
  let certAId: string;
  let presentUserId: string;
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

    presAToken = await registerAndLogin(`certisoa-${Date.now()}@test.io`);
    presBToken = await registerAndLogin(`certisob-${Date.now()}@test.io`);
    orgAId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presAToken}`).send({ name: 'CertIsoA', slug: `certisoa-${Date.now()}` })).body.id;
    orgBId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presBToken}`).send({ name: 'CertIsoB', slug: `certisob-${Date.now()}` })).body.id;

    const eventA = await request(app.getHttpServer()).post(`/organizations/${orgAId}/events`)
      .set('Authorization', `Bearer ${presAToken}`).send({ title: 'Iso Event A', startAt: future(5), endAt: future(6) });
    eventAId = eventA.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgAId}/events/${eventAId}/publish`)
      .set('Authorization', `Bearer ${presAToken}`).expect(200);

    const participantEmail = `iso-p-${Date.now()}@test.io`;
    const participantToken = await registerAndLogin(participantEmail);
    await request(app.getHttpServer())
      .post(`/organizations/${orgAId}/events/${eventAId}/registrations`)
      .set('Authorization', `Bearer ${participantToken}`).send({}).expect(201);
    const mine = await request(app.getHttpServer())
      .get(`/organizations/${orgAId}/events/${eventAId}/attendance/me`)
      .set('Authorization', `Bearer ${participantToken}`).expect(200);
    await request(app.getHttpServer())
      .post(`/organizations/${orgAId}/events/${eventAId}/attendance/scan`)
      .set('Authorization', `Bearer ${presAToken}`).send({ token: mine.body.token }).expect(200);
    const user = await prisma.user.findUnique({ where: { email: participantEmail } });
    presentUserId = user!.id;

    const cert = await request(app.getHttpServer())
      .post(`/organizations/${orgAId}/events/${eventAId}/certificates`)
      .set('Authorization', `Bearer ${presAToken}`)
      .field('userId', presentUserId)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(201);
    certAId = cert.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('org B president cannot list org A\'s certificates via org A\'s own eventId (403 — no membership)', async () => {
    await request(app.getHttpServer())
      .get(`/organizations/${orgAId}/events/${eventAId}/certificates`)
      .set('Authorization', `Bearer ${presBToken}`).expect(403);
  });

  it('org B president cannot upload against org A\'s event (403)', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgAId}/events/${eventAId}/certificates`)
      .set('Authorization', `Bearer ${presBToken}`)
      .field('userId', presentUserId)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(403);
  });

  it('org B president cannot download org A\'s certificate by id (403)', async () => {
    await request(app.getHttpServer())
      .get(`/organizations/${orgAId}/events/${eventAId}/certificates/${certAId}/download`)
      .set('Authorization', `Bearer ${presBToken}`).expect(403);
  });

  it('org B president cannot delete org A\'s certificate (403)', async () => {
    await request(app.getHttpServer())
      .delete(`/organizations/${orgAId}/events/${eventAId}/certificates/${certAId}`)
      .set('Authorization', `Bearer ${presBToken}`).expect(403);
  });

  it('id-guessing: org A\'s own org scope with org B\'s (nonexistent-here) eventId 404s on download', async () => {
    const eventB = await request(app.getHttpServer()).post(`/organizations/${orgBId}/events`)
      .set('Authorization', `Bearer ${presBToken}`).send({ title: 'Iso Event B', startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer())
      .get(`/organizations/${orgAId}/events/${eventB.body.id}/certificates/${certAId}/download`)
      .set('Authorization', `Bearer ${presAToken}`).expect(404);
  });

  it('id-guessing: org A\'s own org+event scope with org B\'s certificateId returns empty/404', async () => {
    const eventB = await request(app.getHttpServer()).post(`/organizations/${orgBId}/events`)
      .set('Authorization', `Bearer ${presBToken}`).send({ title: 'Iso Event B2', startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer()).post(`/organizations/${orgBId}/events/${eventB.body.id}/publish`)
      .set('Authorization', `Bearer ${presBToken}`).expect(200);

    const list = await request(app.getHttpServer())
      .get(`/organizations/${orgAId}/events/${eventAId}/certificates`)
      .set('Authorization', `Bearer ${presAToken}`).expect(200);
    expect(list.body.find((c: { id: string }) => c.id === 'nonexistent')).toBeUndefined();

    await request(app.getHttpServer())
      .get(`/organizations/${orgAId}/events/${eventAId}/certificates/00000000-0000-0000-0000-000000000000/download`)
      .set('Authorization', `Bearer ${presAToken}`).expect(404);
  });

  it('a same-org PARTICIPANT (not committee) cannot list, upload, download-by-id, or delete (403 role gate)', async () => {
    const participantEmail = `iso-role-${Date.now()}@test.io`;
    const participantToken = await registerAndLogin(participantEmail);
    await request(app.getHttpServer())
      .post(`/organizations/${orgAId}/events/${eventAId}/registrations`)
      .set('Authorization', `Bearer ${participantToken}`).send({}).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgAId}/events/${eventAId}/certificates`)
      .set('Authorization', `Bearer ${participantToken}`).expect(403);
    await request(app.getHttpServer())
      .post(`/organizations/${orgAId}/events/${eventAId}/certificates`)
      .set('Authorization', `Bearer ${participantToken}`)
      .field('userId', presentUserId)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/organizations/${orgAId}/events/${eventAId}/certificates/${certAId}/download`)
      .set('Authorization', `Bearer ${participantToken}`).expect(403);
    await request(app.getHttpServer())
      .delete(`/organizations/${orgAId}/events/${eventAId}/certificates/${certAId}`)
      .set('Authorization', `Bearer ${participantToken}`).expect(403);
  });
});

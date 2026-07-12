import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Certificate upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `cert-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
  const pdfBytes = () => Buffer.from('%PDF-1.4\n%mock certificate content\n');

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'CertOrg', slug: `cert-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Cert Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  // Registers a fresh participant, registers them for `eventId`, and has
  // the president scan them PRESENT. Returns their userId (read back via
  // Prisma — no /users/me endpoint exists in this codebase).
  async function presentParticipant() {
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
    return { token, userId: user!.id };
  }

  async function registeredButNotPresent() {
    const email = `np-${Date.now()}-${Math.random()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const user = await prisma.user.findUnique({ where: { email } });
    return { token, userId: user!.id };
  }

  it('committee uploads a PDF certificate for a PRESENT participant', async () => {
    const { userId } = await presentParticipant();
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(res.body.userId).toBe(userId);
    expect(res.body.eventId).toBe(eventId);
  });

  it('a plain participant cannot upload (403)', async () => {
    const { token, userId } = await presentParticipant();
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${token}`)
      .field('userId', userId)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(403);
  });

  it('404 uploading against a nonexistent event', async () => {
    const { userId } = await presentParticipant();
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/00000000-0000-0000-0000-000000000000/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(404);
  });

  it('400 when no file is attached', async () => {
    const { userId } = await presentParticipant();
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .expect(400);
  });

  it('400 rejects a non-PDF file', async () => {
    const { userId } = await presentParticipant();
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', Buffer.from('not a pdf'), { filename: 'cert.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('400 rejects a file over 5MB', async () => {
    const { userId } = await presentParticipant();
    const big = Buffer.alloc(6 * 1024 * 1024, 1);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' })
      .expect(400);
  });

  it('400 rejects a target user who is not PRESENT', async () => {
    const { userId } = await registeredButNotPresent();
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(400);
  });

  it('400 when the upload would exceed the org storage quota', async () => {
    const { userId } = await presentParticipant();
    await prisma.organization.update({ where: { id: orgId }, data: { storageQuotaMb: 0 } });
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(400);
    await prisma.organization.update({ where: { id: orgId }, data: { storageQuotaMb: 1024 } });
  });

  it('409 on a duplicate upload for the same person/event, and the original file survives intact', async () => {
    const { userId } = await presentParticipant();
    const firstBytes = Buffer.from('%PDF-1.4\n%first upload bytes\n');
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', firstBytes, { filename: 'first.pdf', contentType: 'application/pdf' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', Buffer.from('%PDF-1.4\n%second upload bytes\n'), { filename: 'second.pdf', contentType: 'application/pdf' })
      .expect(409);

    const list = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const certId = list.body.find((c: { userId: string }) => c.userId === userId).id;
    const downloadRes = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates/${certId}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const fetched = await fetch(downloadRes.body.downloadUrl);
    const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
    expect(fetchedBytes.equals(firstBytes)).toBe(true);
  });
});

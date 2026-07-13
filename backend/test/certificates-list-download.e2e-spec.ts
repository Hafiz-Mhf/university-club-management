import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Certificate list + me + download (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `certld-${Date.now()}@test.io`;
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
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'CertLDOrg', slug: `certld-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'CertLD Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

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

  it('committee lists certificates for the event without signed URLs', async () => {
    const { userId } = await presentParticipant();
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const entry = res.body.find((c: { userId: string }) => c.userId === userId);
    expect(entry).toBeDefined();
    expect(entry.downloadUrl).toBeUndefined();
    expect(entry.storageKey).toBeUndefined();
  });

  it('a plain participant cannot list (403)', async () => {
    const { token } = await presentParticipant();
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('GET /me returns the caller\'s own certificate with a working signed download URL', async () => {
    const { token, userId } = await presentParticipant();
    const bytes = Buffer.from('%PDF-1.4\n%me test bytes\n');
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', bytes, { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.userId).toBe(userId);
    expect(typeof res.body.downloadUrl).toBe('string');

    const fetched = await fetch(res.body.downloadUrl);
    expect(fetched.status).toBe(200);
    const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
    expect(fetchedBytes.equals(bytes)).toBe(true);
  });

  it('GET /me returns 404 when the caller has no certificate', async () => {
    const { token } = await presentParticipant();
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates/me`)
      .set('Authorization', `Bearer ${token}`).expect(404);
  });

  it('committee download-by-id returns a working signed URL', async () => {
    const { userId } = await presentParticipant();
    const bytes = Buffer.from('%PDF-1.4\n%download test bytes\n');
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', bytes, { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const certId = list.body.find((c: { userId: string }) => c.userId === userId).id;

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates/${certId}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const fetched = await fetch(res.body.downloadUrl);
    const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
    expect(fetchedBytes.equals(bytes)).toBe(true);
  });

  it('404 downloading a certificateId that belongs to a different event', async () => {
    const { userId } = await presentParticipant();
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(201);
    const list = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const certId = list.body.find((c: { userId: string }) => c.userId === userId).id;

    const otherEvent = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Other Event', startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${otherEvent.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${otherEvent.body.id}/certificates/${certId}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });
});

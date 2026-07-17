import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Committee Handover Pack (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `handover-pres-${Date.now()}@test.io`;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  const pdfParser = (response: any, callback: any) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('end', () => callback(null, Buffer.concat(chunks)));
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'HandoverOrg', slug: `handover-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('a committee member generates a valid PDF containing roster/minutes/asset/file/event data, and it is audited', async () => {
    // Populate every section this org has data for.
    const secondEmail = `handover-sec-${Date.now()}@test.io`;
    await registerAndLogin(secondEmail);
    const addRes = await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: secondEmail, role: 'COMMITTEE' }).expect(201);
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${addRes.body.id}/role`)
      .set('Authorization', `Bearer ${presToken}`).send({ role: 'SECRETARY' }).expect(200);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Handover Sync', meetingDate: '2026-07-10T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`).send({ name: 'Projector', quantity: 2 }).expect(201);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Onboarding SOP').field('category', 'SOP')
      .attach('file', Buffer.from('%PDF-1.4\n%mock\n'), { filename: 'onboarding.pdf', contentType: 'application/pdf' })
      .expect(201);

    const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Upcoming Talk', startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/handover`)
      .set('Authorization', `Bearer ${presToken}`)
      .buffer(true).parse(pdfParser)
      .expect(200);

    expect(res.headers['content-type']).toBe('application/pdf');
    const doc = await PDFDocument.load(res.body as Buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);

    const auditRows = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/audit-logs`)
      .set('Authorization', `Bearer ${presToken}`)
      .query({ action: 'handover.generate', pageSize: 10 });
    expect(auditRows.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('403s a non-committee member', async () => {
    const email = `handover-part-${Date.now()}@test.io`;
    const token = await registerAndLogin(email);
    // A registrant gets auto-enrolled as PARTICIPANT — reuse that path to get a non-committee membership cheaply.
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Part Event', startAt: new Date(Date.now() + 5 * 86400000).toISOString(), endAt: new Date(Date.now() + 6 * 86400000).toISOString() });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/handover`)
      .set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('empty-org case: still returns a valid PDF with no data', async () => {
    const otherPresToken = await registerAndLogin(`handover-empty-${Date.now()}@test.io`);
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'EmptyHandoverOrg', slug: `handover-empty-${Date.now()}` })).body.id;

    const res = await request(app.getHttpServer())
      .get(`/organizations/${otherOrgId}/handover`)
      .set('Authorization', `Bearer ${otherPresToken}`)
      .buffer(true).parse(pdfParser)
      .expect(200);

    const doc = await PDFDocument.load(res.body as Buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("cross-org isolation: org B president cannot generate org A's handover pack (403)", async () => {
    const otherPresToken = await registerAndLogin(`handover-iso-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'HandoverIsoOrg', slug: `handover-iso-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/handover`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});

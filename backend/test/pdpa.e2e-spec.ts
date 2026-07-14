import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PDPA (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  describe('signup consent', () => {
    it('rejects registration without consent (400)', async () => {
      await request(app.getHttpServer()).post('/auth/register')
        .send({ email: `pdpa-nc-${Date.now()}@test.io`, password: 'password123', fullName: 'NoConsent' })
        .expect(400);
    });

    it('rejects registration with consent: false (400)', async () => {
      await request(app.getHttpServer()).post('/auth/register')
        .send({ email: `pdpa-fc-${Date.now()}@test.io`, password: 'password123', fullName: 'FalseConsent', consent: false })
        .expect(400);
    });

    it('records an account ConsentRecord on registration', async () => {
      const email = `pdpa-c-${Date.now()}@test.io`;
      const res = await request(app.getHttpServer()).post('/auth/register')
        .send({ email, password: 'password123', fullName: 'Consenting', consent: true })
        .expect(201);
      const consents = await prisma.consentRecord.findMany({ where: { userId: res.body.id } });
      expect(consents).toHaveLength(1);
      expect(consents[0].purpose).toBe('account');
      expect(consents[0].policyVersion).toBe('v1');
      expect(consents[0].grantedAt).toBeInstanceOf(Date);
    });
  });
});

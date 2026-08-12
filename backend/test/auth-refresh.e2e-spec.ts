import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth refresh/logout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `rf-${Date.now()}@test.io`;

  async function login() {
    const res = await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' });
    return res.body.refreshToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: 'RF', consent: true });
  });
  afterAll(async () => { await app.close(); });

  it('rotates: refresh returns a new pair and old token stops working', async () => {
    const oldRt = await login();
    const refreshed = await request(app.getHttpServer()).post('/auth/refresh')
      .send({ refreshToken: oldRt }).expect(201);
    expect(refreshed.body.accessToken).toBeDefined();
    expect(refreshed.body.refreshToken).toBeDefined();
    expect(refreshed.body.refreshToken).not.toBe(oldRt);
    // reuse of the rotated-away token is rejected
    await request(app.getHttpServer()).post('/auth/refresh')
      .send({ refreshToken: oldRt }).expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const rt = await login();
    await request(app.getHttpServer()).post('/auth/logout')
      .send({ refreshToken: rt }).expect(201);
    await request(app.getHttpServer()).post('/auth/refresh')
      .send({ refreshToken: rt }).expect(401);
  });

  describe('reuse detection', () => {
    const victimEmail = `rf-reuse-${Date.now()}@test.io`;

    it('replaying a rotated token kills the whole token family and audits it', async () => {
      await request(app.getHttpServer()).post('/auth/register')
        .send({ email: victimEmail, password: 'password123', fullName: 'Victim', consent: true }).expect(201);
      const userId = (await prisma.user.findUnique({ where: { email: victimEmail } }))!.id;

      const stolen = (await request(app.getHttpServer()).post('/auth/login')
        .send({ email: victimEmail, password: 'password123' })).body.refreshToken;

      // Attacker rotates first, obtaining a live token of their own.
      const attackerRt = (await request(app.getHttpServer()).post('/auth/refresh')
        .send({ refreshToken: stolen }).expect(201)).body.refreshToken;

      // Victim replays their now-rotated copy: detected as reuse, not just invalid.
      await request(app.getHttpServer()).post('/auth/refresh')
        .send({ refreshToken: stolen }).expect(401);

      // The attacker's token must be dead too — that is the point of detection.
      await request(app.getHttpServer()).post('/auth/refresh')
        .send({ refreshToken: attackerRt }).expect(401);

      const active = await prisma.refreshToken.count({ where: { userId, revokedAt: null } });
      expect(active).toBe(0);

      const audits = await prisma.auditLog.findMany({
        where: { organizationId: { equals: null }, actorUserId: userId, action: 'auth.refresh.reuse_detected' },
      });
      // Every replay of a revoked token is logged, so the attacker's token
      // being presented after the family was killed records its own entry —
      // one incident can legitimately produce more than one row.
      expect(audits.length).toBeGreaterThanOrEqual(1);
      expect(audits[0].targetType).toBe('User');
      expect(audits[0].targetId).toBe(userId);
    });

    it('a garbage token is rejected without nuking a healthy session', async () => {
      const email2 = `rf-healthy-${Date.now()}@test.io`;
      await request(app.getHttpServer()).post('/auth/register')
        .send({ email: email2, password: 'password123', fullName: 'Healthy', consent: true }).expect(201);
      const good = (await request(app.getHttpServer()).post('/auth/login')
        .send({ email: email2, password: 'password123' })).body.refreshToken;

      await request(app.getHttpServer()).post('/auth/refresh')
        .send({ refreshToken: 'not-a-jwt' }).expect(401);

      // Unrelated garbage must not revoke anything.
      await request(app.getHttpServer()).post('/auth/refresh')
        .send({ refreshToken: good }).expect(201);
    });
  });

  describe('audit logging', () => {
    it('records login, failed login, and logout', async () => {
      const email3 = `rf-audit-${Date.now()}@test.io`;
      await request(app.getHttpServer()).post('/auth/register')
        .send({ email: email3, password: 'password123', fullName: 'Audited', consent: true }).expect(201);
      const userId = (await prisma.user.findUnique({ where: { email: email3 } }))!.id;

      const rt = (await request(app.getHttpServer()).post('/auth/login')
        .send({ email: email3, password: 'password123' }).expect(201)).body.refreshToken;
      await request(app.getHttpServer()).post('/auth/login')
        .send({ email: email3, password: 'wrong-password' }).expect(401);
      await request(app.getHttpServer()).post('/auth/logout')
        .send({ refreshToken: rt }).expect(201);

      const actions = (await prisma.auditLog.findMany({ where: { organizationId: { equals: null }, actorUserId: userId } })).map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining([
        'auth.register', 'auth.login', 'auth.login.failed', 'auth.logout',
      ]));
    });

    it('never writes the credential into the audit row', async () => {
      const email4 = `rf-nopii-${Date.now()}@test.io`;
      await request(app.getHttpServer()).post('/auth/register')
        .send({ email: email4, password: 'password123', fullName: 'NoPii', consent: true }).expect(201);
      const userId = (await prisma.user.findUnique({ where: { email: email4 } }))!.id;
      await request(app.getHttpServer()).post('/auth/login')
        .send({ email: email4, password: 'password123' }).expect(201);

      const rows = await prisma.auditLog.findMany({ where: { organizationId: { equals: null }, actorUserId: userId } });
      const blob = JSON.stringify(rows);
      expect(blob).not.toContain('password123');
      expect(blob).not.toContain(email4);
    });
  });
});

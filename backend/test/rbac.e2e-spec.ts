import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  it('PRESIDENT can update settings; VOLUNTEER cannot', async () => {
    // President creates org
    const pEmail = `pres-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register').send({ email: pEmail, password: 'password123', fullName: 'P' });
    const pLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: pEmail, password: 'password123' });
    const pToken = pLogin.body.accessToken;
    const org = await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', `Bearer ${pToken}`).send({ name: 'RB', slug: `rb-${Date.now()}` });
    const orgId = org.body.id;

    // President updates settings -> 200
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/settings`)
      .set('Authorization', `Bearer ${pToken}`).send({ primaryColor: '#ff0000' }).expect(200);

    // Volunteer joins org (seed membership directly), then is forbidden
    const vEmail = `vol-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register').send({ email: vEmail, password: 'password123', fullName: 'V' });
    const vUser = await prisma.user.findUnique({ where: { email: vEmail } });
    await prisma.membership.create({ data: { userId: vUser!.id, organizationId: orgId, role: 'VOLUNTEER' } });
    const vLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: vEmail, password: 'password123' });
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/settings`)
      .set('Authorization', `Bearer ${vLogin.body.accessToken}`).send({ primaryColor: '#00ff00' }).expect(403);
  });
});

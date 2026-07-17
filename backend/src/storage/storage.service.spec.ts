import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let storage: StorageService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) => {
              const values: Record<string, string> = {
                S3_ENDPOINT: 'http://localhost:9000',
                S3_ACCESS_KEY: 'minio',
                S3_SECRET_KEY: 'minio_dev_password',
                S3_BUCKET: 'ucm-test',
              };
              return values[key] ?? fallback;
            },
          },
        },
      ],
    }).compile();
    storage = moduleRef.get(StorageService);
    await storage.onModuleInit();
  });

  it('round-trips an object through putObject + a signed download URL', async () => {
    const key = `test/${Date.now()}-${Math.random()}.txt`;
    const body = Buffer.from('hello certificate storage');

    await storage.putObject(key, body, 'text/plain');

    const url = await storage.getSignedDownloadUrl(key, 60);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const downloaded = Buffer.from(await res.arrayBuffer());
    expect(downloaded.equals(body)).toBe(true);

    await storage.deleteObject(key);
  });

  it('getObject returns the exact bytes previously written', async () => {
    const key = `test/${Date.now()}-${Math.random()}.txt`;
    const body = Buffer.from('hello getObject');
    await storage.putObject(key, body, 'text/plain');

    const fetched = await storage.getObject(key);
    expect(fetched.equals(body)).toBe(true);

    await storage.deleteObject(key);
  });

  it('deleteObject removes the object — a subsequent signed URL fetch 404s', async () => {
    const key = `test/${Date.now()}-${Math.random()}.txt`;
    await storage.putObject(key, Buffer.from('temp'), 'text/plain');

    const url = await storage.getSignedDownloadUrl(key, 60);
    await storage.deleteObject(key);

    const res = await fetch(url);
    expect(res.status).toBe(404);
  });
});

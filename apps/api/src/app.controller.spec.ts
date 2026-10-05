import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './storage/storage.service';

describe('AppController', () => {
  async function build(db: boolean, storage: boolean) {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: () =>
              db ? Promise.resolve([1]) : Promise.reject(new Error('x')),
          },
        },
        {
          provide: StorageService,
          useValue: { isHealthy: () => Promise.resolve(storage) },
        },
      ],
    }).compile();
    return app.get(AppController);
  }

  it('health ok cuando BD y almacenamiento responden', async () => {
    const c = await build(true, true);
    expect(await c.health()).toEqual({ status: 'ok', db: true, storage: true });
  });

  it('health degradado cuando la BD falla', async () => {
    const c = await build(false, true);
    expect(await c.health()).toEqual({
      status: 'degraded',
      db: false,
      storage: true,
    });
  });
});

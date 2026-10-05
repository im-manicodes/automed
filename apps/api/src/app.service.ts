import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './storage/storage.service';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  db: boolean;
  storage: boolean;
}

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Salud del servicio (sin datos sensibles): BD y almacenamiento accesibles. */
  async health(): Promise<HealthStatus> {
    const [db, storage] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      this.storage.isHealthy(),
    ]);
    return { status: db && storage ? 'ok' : 'degraded', db, storage };
  }
}

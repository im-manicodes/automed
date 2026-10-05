import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/** pg ignora ?schema= de la URL: se pasa explícitamente al adaptador (los tests usan un esquema aislado). */
export function createPgAdapter(url: string) {
  let schema: string | undefined;
  try {
    schema = new URL(url).searchParams.get('schema') ?? undefined;
  } catch {
    schema = undefined;
  }
  return new PrismaPg({ connectionString: url }, { schema });
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    super({
      adapter: createPgAdapter(config.getOrThrow<string>('DATABASE_URL')),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

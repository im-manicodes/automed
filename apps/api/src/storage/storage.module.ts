import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FsStorageService } from './fs-storage.service';
import { S3StorageService } from './s3-storage.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      // STORAGE_DRIVER=fs (escritorio) | s3 (por defecto: RustFS/S3).
      useFactory: (config: ConfigService): StorageService =>
        config.get<string>('STORAGE_DRIVER') === 'fs'
          ? new FsStorageService(config)
          : new S3StorageService(config),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}

import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsModule } from '../settings/settings.module';
import { DynamicStorageService } from './dynamic-storage.service';
import { FsStorageService } from './fs-storage.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  imports: [SettingsModule],
  providers: [
    DynamicStorageService,
    {
      provide: StorageService,
      inject: [ConfigService, DynamicStorageService],
      // STORAGE_DRIVER=fs (escritorio) | por defecto: S3 dinámico (RustFS/AWS S3 elegido en Ajustes o .env).
      useFactory: (
        config: ConfigService,
        dynamic: DynamicStorageService,
      ): StorageService =>
        config.get<string>('STORAGE_DRIVER') === 'fs'
          ? new FsStorageService(config)
          : dynamic,
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}

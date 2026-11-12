import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './config';
import { LOG_STREAM } from './logging';

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig(process.env) },
    { provide: LOG_STREAM, useValue: process.stdout },
  ],
  exports: [CONFIG, LOG_STREAM],
})
export class ConfigModule {}

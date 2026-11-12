import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BOOT_OPTIONS, configureApi, exitOnBootFailure } from './bootstrap/configure';
import { CONFIG, type Config } from './core/config';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, BOOT_OPTIONS);
  configureApi(app);
  await app.listen(app.get<Config>(CONFIG).port);
}

main().catch(exitOnBootFailure);

import { ConsoleLogger, type INestApplication, type INestApplicationContext, type NestApplicationOptions } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { pino } from 'pino';
import { CONFIG, type Config } from '../core/config';

/**
 * Options for NestFactory in both entrypoints. Boot logs are held until the pino
 * logger is attached; if boot fails first, Nest flushes them through its JSON
 * console logger instead, and the error reaches exitOnBootFailure.
 */
export const BOOT_OPTIONS: NestApplicationOptions = {
  bufferLogs: true,
  abortOnError: false,
  logger: new ConsoleLogger({ json: true }),
};

/** Every API route lives under /api, so the web app can rewrite /api/* to it. */
export const API_PREFIX = 'api';

export function configureApi(app: INestApplication): void {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  // req.ip is the X-Forwarded-For client only behind these; see Config.trustedProxies.
  const { trustedProxies } = app.get<Config>(CONFIG);
  (app.getHttpAdapter().getInstance() as { set(name: string, value: unknown): void }).set(
    'trust proxy',
    trustedProxies.length > 0 ? trustedProxies : false,
  );
  app.enableShutdownHooks();
}

export function configureWorker(app: INestApplicationContext): void {
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}

/** A boot that throws before Nest's logger exists still ends as one JSON line. */
export function exitOnBootFailure(error: unknown): never {
  pino().fatal({ err: error }, 'boot failed');
  process.exit(1);
}

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { CONFIG, type Config } from './config';

/** Where log lines go: stdout in both processes, a capture stream in tests. */
export const LOG_STREAM = Symbol('LOG_STREAM');

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

// Keeps a caller's request id when it looks sane, so a proxy's id follows the
// request into our logs; otherwise mints one. Either way the response echoes it.
function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

// One JSON object per line. Lines logged while serving a request carry its
// `requestId`; the worker logs the same way with no request.
export const LoggingModule = LoggerModule.forRootAsync({
  inject: [CONFIG, LOG_STREAM],
  useFactory: (config: Config, stream: NodeJS.WritableStream) => ({
    pinoHttp: [
      {
        level: config.logLevel,
        genReqId: requestId,
        quietReqLogger: true,
        customAttributeKeys: { reqId: 'requestId' },
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
      stream,
    ],
  }),
});

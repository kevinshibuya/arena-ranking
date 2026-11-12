import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> })
  .scripts;

// Every root script name the spec's tickets use. The name never goes away.
const names = [
  'typecheck',
  'lint',
  'test',
  'smoke',
  'db:up',
  'migrate',
  'fixtures:check',
  'record-fixtures',
  'riot:queues',
  'replay',
  'smoke:og',
  'images:build',
  'stack:smoke',
  'stack:restore-test',
];

describe('root scripts', () => {
  it.each(names)('defines %s', (name) => {
    expect(scripts[name]).toBeDefined();
  });
});

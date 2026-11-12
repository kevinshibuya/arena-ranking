// Checks the production compose file, as `docker compose --profile ops config --format json`
// renders it, against the house rule and the spec's budget. Run by bin/smoke.sh:
//
//   node test/check-compose.mjs <rendered.json> <compose.yaml>
//
// Prints each problem and exits 1, or prints "compose ok".
import { readFileSync } from 'node:fs';

const [renderedPath, sourcePath] = process.argv.slice(2);
const config = JSON.parse(readFileSync(renderedPath, 'utf8'));
const source = readFileSync(sourcePath, 'utf8');
const services = config.services ?? {};
const problems = [];

const MiB = 1024 * 1024;
// Memory budget in MiB.
const budget = { web: 384, api: 512, worker: 512, postgres: 2048, redis: 256, migrate: 256, backup: 256 };
const oneShots = ['migrate', 'backup'];
const keyFile = '/run/secrets/riot.key';

const names = Object.keys(services).sort();
if (names.join() !== Object.keys(budget).sort().join()) problems.push(`services are ${names.join(', ')}`);
if (/^\s*env_file\s*:/m.test(source)) problems.push('an env_file directive');

const networksOf = (name) => Object.keys(services[name]?.networks ?? {}).sort();

for (const [name, mib] of Object.entries(budget)) {
  const service = services[name];
  if (!service) continue;
  if (Number(service.mem_limit) !== mib * MiB) problems.push(`${name}: mem_limit ${service.mem_limit}, want ${mib} MiB`);
  if (!(Number(service.cpus) > 0)) problems.push(`${name}: no CPU limit`);
  if (!(Number(service.pids_limit) > 0)) problems.push(`${name}: no pids limit`);
  if (Number(service.cpu_shares) !== 512) problems.push(`${name}: cpu_shares ${service.cpu_shares}, want 512`);

  const health = service.healthcheck;
  if (oneShots.includes(name)) {
    if (!health?.disable) problems.push(`${name}: a one-shot whose healthcheck is not disabled`);
    if (service.profiles?.join() !== 'ops') problems.push(`${name}: profiles ${service.profiles}, want ops`);
  } else if (!health?.test?.length || !health.timeout) {
    problems.push(`${name}: no healthcheck with a timeout`);
  }

  const log = service.logging ?? {};
  if (log.driver !== 'json-file' || log.options?.['max-size'] !== '10m' || log.options?.['max-file'] !== '3') {
    problems.push(`${name}: logging ${JSON.stringify(log)}`);
  }

  const image = service.image ?? '';
  if (!image.includes(':') || image.endsWith(':latest')) problems.push(`${name}: image ${image} has no exact tag`);
  if ('build' in service) problems.push(`${name}: a build block`);
  if (service.privileged || service.cap_add) problems.push(`${name}: privileged or cap_add`);

  for (const port of service.ports ?? []) {
    if (name !== 'api' || port.host_ip !== '127.0.0.1') problems.push(`${name}: publishes ${JSON.stringify(port)}`);
  }
}

// Caddy reaches web alone; postgres and redis sit on the private network only.
const onWeb = names.filter((name) => networksOf(name).includes('web'));
if (onWeb.join() !== 'web') problems.push(`services on the Caddy network: ${onWeb.join(', ')}`);
if (!services.web?.networks?.web?.aliases?.includes('arena-ranking-web')) problems.push('web has no arena-ranking-web alias');
const caddy = config.networks?.web;
if (!caddy?.external || caddy.name !== 'web') problems.push(`web network is ${JSON.stringify(caddy)}`);
for (const name of ['postgres', 'redis']) {
  if (networksOf(name).join() !== 'internal') problems.push(`${name} networks ${networksOf(name).join(', ')}`);
}
if (config.networks?.internal?.external) problems.push('internal network is external');

// The key file: read-only into api and worker at RIOT_KEY_FILE, nowhere else.
for (const name of names) {
  const mounts = (services[name].volumes ?? []).filter((volume) => volume.source?.endsWith('/riot.key'));
  if (['api', 'worker'].includes(name)) {
    const [mount] = mounts;
    if (mounts.length !== 1 || mount.target !== keyFile || mount.read_only !== true) {
      problems.push(`${name}: key mount ${JSON.stringify(mounts)}`);
    }
    if (services[name].environment?.RIOT_KEY_FILE !== keyFile) problems.push(`${name}: RIOT_KEY_FILE is not ${keyFile}`);
    const uid = String(services[name].user ?? '').split(':')[0];
    if (uid === '' || uid === '0' || uid === 'root') problems.push(`${name}: user ${services[name].user}`);
  } else if (mounts.length > 0) {
    problems.push(`${name}: mounts the key file`);
  }
}

if (problems.length > 0) {
  console.error(problems.map((problem) => `compose FAIL: ${problem}`).join('\n'));
  process.exit(1);
}
console.log('compose ok');

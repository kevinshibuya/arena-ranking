// `pnpm smoke:og`: against a fresh stack (scripts/smoke/launcher.ts), lets the
// recorded player's primary sync finish and runs the replay, then fetches the
// profile and ladder pages as a link-preview bot would and checks the OpenGraph
// and Twitter tags are in the server-rendered <head>: the player's numbers,
// rating and rank, and the ladder's format, scope and top entry.

import type { LadderPositionResponse, LadderResponse, ProfileResponse, RatingResponse } from '../packages/shared/src';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { launch, replay, type Stack } from './smoke/launcher';

const manifest = JSON.parse(
  readFileSync(join(__dirname, '../apps/fake-upstream/fixtures-anon/manifest.json'), 'utf8'),
) as { players: Array<{ gameName: string; tagLine: string; currentSeasonMatchIds: string[] }> };
const player = manifest.players[0]!;
const riotId = `${player.gameName}#${player.tagLine}`;

// Discord's crawler reads no JavaScript; Next serves it metadata in <head>.
const BOT_USER_AGENT = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';

async function syncedProfile(webUrl: string): Promise<ProfileResponse> {
  const url = `${webUrl}/api/profiles/br/${encodeURIComponent(player.gameName)}/${encodeURIComponent(player.tagLine)}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GET ${url}: ${response.status} ${await response.text()}`);
    const profile = (await response.json()) as ProfileResponse;
    if (profile.syncState !== 'primary-syncing') return profile;
    await sleep(500);
  }
  throw new Error(`${riotId} still primary-syncing after 60s`);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** `property` or `name` → content, for every <meta> in the HTML given. */
function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/g)) {
    const key = /\b(?:property|name)="([^"]+)"/.exec(tag)?.[1];
    const content = /\bcontent="([^"]*)"/.exec(tag)?.[1];
    if (key && content !== undefined) tags.set(key, decodeEntities(content));
  }
  return tags;
}

async function apiJson<T>(webUrl: string, path: string): Promise<T> {
  const response = await fetch(`${webUrl}${path}`);
  if (!response.ok) throw new Error(`GET ${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

/** Fetches a page as the bot and checks each tag in <head> holds every part given; resolves to the failures. */
async function checkTags(webUrl: string, pagePath: string, expectations: Array<[string, string[]]>): Promise<number> {
  console.log(`GET ${pagePath}`);
  const response = await fetch(`${webUrl}${pagePath}`, { headers: { 'user-agent': BOT_USER_AGENT } });
  const html = await response.text();
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
  const tags = metaTags(head);

  let failures = 0;
  if (response.status !== 200) {
    console.error(`✘ GET ${pagePath}: ${response.status}`);
    failures++;
  }
  for (const [key, parts] of expectations) {
    const content = tags.get(key);
    const missing = parts.filter((part) => !content?.includes(part));
    if (missing.length === 0) {
      console.log(`✓ ${key}: ${content}`);
    } else {
      const found = content === undefined ? 'absent from <head>' : JSON.stringify(content);
      console.error(`✘ ${key}: ${found}, wanted ${missing.map((part) => JSON.stringify(part)).join(', ')}`);
      failures++;
    }
  }
  return failures;
}

async function check(stack: Stack): Promise<number> {
  const { webUrl } = stack;
  const profile = await syncedProfile(webUrl);
  await replay(stack);
  const { totals } = profile;
  const riotIdPath = `${encodeURIComponent(player.gameName)}/${encodeURIComponent(player.tagLine)}`;
  const rating = await apiJson<RatingResponse>(webUrl, `/api/profiles/br/${riotIdPath}/rating`);
  const position = await apiJson<LadderPositionResponse>(webUrl, `/api/ladders/br/players/${riotIdPath}`);
  const ladder = await apiJson<LadderResponse>(webUrl, '/api/ladders/br');
  if (!position.ranked || rating.rating === null) throw new Error(`${riotId} is not ranked after the replay`);
  const top = ladder.entries[0]!;
  if (ladder.scope.kind !== 'season') throw new Error('the default ladder is not a season');

  const games = `${player.currentSeasonMatchIds.length} games`;
  const top4 = `${Math.round(totals.top4Rate! * 100)}% top 4`;
  const average = `average placement ${totals.averagePlacement!.toFixed(1)}`;
  const standing = [`rating ${rating.rating.toFixed(1)}`, `#${position.rank} on the ladder`];
  let failures = await checkTags(webUrl, `/br/${encodeURIComponent(player.gameName)}-${encodeURIComponent(player.tagLine)}`, [
    ['og:title', [riotId, '6 teams of 3']],
    ['og:description', [games, top4, average, ...standing]],
    ['og:type', ['profile']],
    ['twitter:card', ['summary']],
    ['twitter:title', [riotId, '6 teams of 3']],
    ['twitter:description', [games, top4, average, ...standing]],
  ]);

  const ladderTitle = ['ladder', '6 teams of 3', ladder.scope.name];
  const leader = [`#1 ${top.player.gameName}#${top.player.tagLine}`, `rating ${top.rating.toFixed(1)}`];
  failures += await checkTags(webUrl, '/ladder', [
    ['og:title', ladderTitle],
    ['og:description', leader],
    ['og:type', ['website']],
    ['twitter:card', ['summary']],
    ['twitter:title', ladderTitle],
    ['twitter:description', leader],
  ]);

  console.log(failures === 0 ? 'smoke:og: passed' : `smoke:og: ${failures} failed`);
  return failures === 0 ? 0 : 1;
}

launch({ run: check });

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LadderPositionResponse, LadderResponse, RatingResponse, SeasonsResponse } from '@arena/shared';
import { expect, expectFitsPhoneWidth, test } from './fixtures';
import { apiJson, completePlayer, replay } from './stack';

const manifest = JSON.parse(
  readFileSync(join(__dirname, '../../fake-upstream/fixtures-anon/manifest.json'), 'utf8'),
) as { players: Array<{ gameName: string; tagLine: string; currentSeasonMatchIds: string[] }> };
const primary = manifest.players[0]!;

test.describe.configure({ timeout: 90_000 });

// The recorded player's sync and backfill bring in everyone in their lobbies;
// the replay rates them all. The launcher lowers LADDER_MIN_GAMES so several are listed.
test.beforeAll(async () => {
  test.setTimeout(120_000);
  await completePlayer(primary.gameName, primary.tagLine);
  await replay();
});

function riotIdOf(entry: LadderResponse['entries'][number]): string {
  return `${entry.player.gameName}#${entry.player.tagLine}`;
}

test("the ladder lists the API's ranked players in its order, with rank numbers and profile links", async ({ page }) => {
  const api = await apiJson<LadderResponse>('/api/ladders/br?limit=100');
  expect(api.entries.length).toBeGreaterThan(1);

  // The first visit to a route compiles it under `next dev`.
  await page.goto('/ladder', { timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ladder');
  const rows = page.getByRole('table', { name: 'Ladder' }).locator('tbody tr');
  await expect(rows).toHaveCount(api.entries.length);
  await expect(rows.locator('[data-testid="rank"]')).toHaveText(api.entries.map((entry) => String(entry.rank)));
  await expect(rows.getByRole('link')).toHaveText(api.entries.map(riotIdOf));

  const top = api.entries[0]!;
  await expect(rows.first().getByRole('link')).toHaveAttribute(
    'href',
    `/br/${encodeURIComponent(top.player.gameName!)}-${encodeURIComponent(top.player.tagLine!)}`,
  );
  await expect(page.getByTestId('last-update')).not.toHaveText('');
  await expect(page.getByTestId('next-update')).not.toHaveText('');
  await expectFitsPhoneWidth(page);
});

test('load more at limit=1 appends the next page without a reload', async ({ page }) => {
  const api = await apiJson<LadderResponse>('/api/ladders/br?limit=100');
  await page.goto('/ladder?limit=1');
  const rows = page.getByRole('table', { name: 'Ladder' }).locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await page.evaluate(() => Object.assign(window, { smokeSamePage: true }));

  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.getByTestId('rank')).toHaveText(['1', '2']);
  await expect(rows.getByRole('link')).toHaveText(api.entries.slice(0, 2).map(riotIdOf));
  expect(await page.evaluate(() => 'smokeSamePage' in window), 'the page was not reloaded').toBe(true);
  await expect(page).toHaveURL(/\/ladder\?limit=1$/);
});

test('switching format or scope changes the URL and the rows', async ({ page }) => {
  const { seasons } = await apiJson<SeasonsResponse>('/api/seasons');
  const current = seasons.find((season) => season.current)!;
  const rows = page.getByRole('table', { name: 'Ladder' }).locator('tbody tr');

  /** The page shows the API's ladder for this query: its rows in order, or the empty message. */
  async function expectLadder(query: string) {
    const api = await apiJson<LadderResponse>(`/api/ladders/br?${query}&limit=100`);
    if (api.entries.length === 0) {
      await expect(page.getByTestId('ladder-empty')).toBeVisible();
      await expect(rows).toHaveCount(0);
      return api;
    }
    await expect(rows.getByRole('link')).toHaveText(api.entries.map(riotIdOf));
    await expect(rows.getByTestId('rating')).toHaveText(api.entries.map((entry) => entry.rating.toFixed(1)));
    return api;
  }

  await page.goto('/ladder');
  const currentSeason = await expectLadder(`format=6x3&season=${current.id}`);

  await page.getByRole('navigation', { name: 'Format' }).getByRole('link', { name: '8 teams of 2' }).click();
  await expect(page).toHaveURL(`/ladder?format=8x2&season=${current.id}`);
  await expectLadder(`format=8x2&season=${current.id}`);

  await page.getByRole('navigation', { name: 'Format' }).getByRole('link', { name: '6 teams of 3' }).click();
  await expect(page).toHaveURL(`/ladder?format=6x3&season=${current.id}`);
  await page.getByRole('link', { name: 'All-time' }).click();
  await expect(page).toHaveURL('/ladder?format=6x3&season=all');
  const allTime = await expectLadder('format=6x3&season=all');
  // All-time also rates the recorded player's earlier seasons.
  expect(allTime.entries.map((entry) => entry.rating)).not.toEqual(currentSeason.entries.map((entry) => entry.rating));
});

test("the find box reports a ranked player's rank and an unranked player's state", async ({ page }) => {
  const position = await apiJson<LadderPositionResponse>(`/api/ladders/br/players/${primary.gameName}/${primary.tagLine}`);
  if (!position.ranked) throw new Error(`${primary.gameName}#${primary.tagLine} is not ranked on the default ladder`);
  const riotId = `${primary.gameName}#${primary.tagLine}`;
  const result = page.getByTestId('find-result');

  async function find(text: string) {
    await page.getByLabel('Find a Riot ID on this ladder').fill(text);
    await page.getByRole('button', { name: 'Find' }).click();
  }

  await page.goto('/ladder');
  await find(riotId.toUpperCase());
  await expect(result).toHaveText(`${riotId} is #${position.rank} on this ladder, rating ${position.rating.toFixed(1)}.`);
  await expect(result.getByRole('link')).toHaveAttribute('href', `/br/${primary.gameName}-${primary.tagLine}`);

  // Season 1 holds one of the recorded player's games, short of the minimum.
  await page.getByRole('link', { name: '2026 Season 1' }).click();
  await expect(page).toHaveURL(/\?format=6x3&season=\d+$/);
  await find(riotId);
  await expect(result).toHaveText(`${riotId} is unranked: 1 game, ${position.minGames - 1} more games to be listed.`);

  await find('Ninguem#0000');
  await expect(result).toHaveText("Ninguem#0000 isn't tracked yet. Search them on the home page to add them.");
});

test('a ladder row opens the profile, with its rating, ranked state and a chart point per rated match', async ({ page }) => {
  const riotId = `${primary.gameName}#${primary.tagLine}`;
  const rating = await apiJson<RatingResponse>(`/api/profiles/br/${primary.gameName}/${primary.tagLine}/rating`);
  const position = await apiJson<LadderPositionResponse>(`/api/ladders/br/players/${primary.gameName}/${primary.tagLine}`);
  if (!position.ranked) throw new Error(`${riotId} is not ranked on the default ladder`);
  expect(rating.history).toHaveLength(primary.currentSeasonMatchIds.length);

  await page.goto('/ladder');
  await page.getByRole('table', { name: 'Ladder' }).getByRole('link', { name: riotId }).click();
  await expect(page).toHaveURL(`/br/${primary.gameName}-${primary.tagLine}`, { timeout: 30_000 });

  const section = page.getByRole('region', { name: 'Rating' });
  const points = section.getByRole('table', { name: 'Rating history' }).locator('tbody tr');
  await expect(section.getByTestId('rating')).toHaveText(rating.rating!.toFixed(1), { timeout: 60_000 });
  await expect(section.getByTestId('ranked-state')).toHaveText(`Ranked #${position.rank} on the 6 teams of 3 ladder`);
  await expect(section.locator('.recharts-line-curve')).toBeVisible();
  await expect(points).toHaveCount(rating.history.length);

  await page.getByRole('link', { name: '2026 Season 1' }).click();
  await expect(section.getByTestId('ranked-state')).toHaveText(
    `Unranked: 1 game, ${position.minGames - 1} more games to be listed`,
  );
  await expect(points).toHaveCount(1);
  await expectFitsPhoneWidth(page);
});

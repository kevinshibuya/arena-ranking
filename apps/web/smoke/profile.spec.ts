import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, expectFitsPhoneWidth, test } from './fixtures';
import { completePlayer } from './stack';

// The stack serves the committed Riot fixtures; the manifest says what they hold.
const manifest = JSON.parse(
  readFileSync(join(__dirname, '../../fake-upstream/fixtures-anon/manifest.json'), 'utf8'),
) as { players: Array<{ gameName: string; tagLine: string; currentSeasonMatchIds: string[] }> };
const primary = manifest.players[0]!;
const currentSeasonGames = primary.currentSeasonMatchIds.length;

test.describe.configure({ timeout: 90_000 });

test('a search for the recorded player shows their games once the sync is in, without a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Riot ID').fill(`${primary.gameName}#${primary.tagLine}`);
  await page.getByRole('button', { name: 'Search' }).click();

  // The first visit to a route compiles it under `next dev`.
  await expect(page).toHaveURL(`/br/${primary.gameName}-${primary.tagLine}`, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${primary.gameName}#${primary.tagLine}`);
  await expect(page.getByTestId('games')).toHaveText(String(currentSeasonGames), { timeout: 60_000 });
  // Until the earlier seasons are in, the banner says they are missing; the backfill may beat this line.
  await expect(page.getByRole('status').filter({ hasNotText: 'earlier 2026 seasons' })).toHaveCount(0);
});

test('once the earlier seasons are in, the banner is gone and they count in their season', async ({ page }) => {
  await completePlayer(primary.gameName, primary.tagLine);
  await page.goto(`/br/${primary.gameName}-${primary.tagLine}`);
  await expect(page.getByTestId('games')).toHaveText(String(currentSeasonGames), { timeout: 60_000 });
  await expect(page.getByRole('status')).toHaveCount(0);

  await page.getByRole('link', { name: '2026 Season 1' }).click();
  await expect(page).toHaveURL(/\?format=6x3&season=\d+$/, { timeout: 30_000 });
  await expect(page.getByTestId('games')).toHaveText('1', { timeout: 30_000 });
});

test('format and season choices live in the URL and survive a reload', async ({ page }) => {
  await completePlayer(primary.gameName, primary.tagLine);
  await page.goto(`/br/${primary.gameName}-${primary.tagLine}`);
  const games = page.getByTestId('games');
  await expect(games).toHaveText(String(currentSeasonGames), { timeout: 60_000 });
  await expect(page.getByRole('navigation', { name: 'Format' }).getByRole('link', { name: '6 teams of 3' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // Season 2's twenty recorded 6x3 games and the last-patch match.
  await page.getByRole('link', { name: '2026 Season 2' }).click();
  await expect(page).toHaveURL(/\?format=6x3&season=\d+$/);
  await expect(games).toHaveText('21');

  // And the derived Season 1 game.
  await page.getByRole('link', { name: 'All-time' }).click();
  await expect(page).toHaveURL(/\?format=6x3&season=all$/);
  await expect(games).toHaveText(String(currentSeasonGames + 22));

  // Season 2's ten recorded 8x2 games and the derived Season 3 one.
  await page.getByRole('navigation', { name: 'Format' }).getByRole('link', { name: '8 teams of 2' }).click();
  await expect(page).toHaveURL(/\?format=8x2&season=all$/);
  await expect(games).toHaveText('11');

  await page.reload();
  await expect(games).toHaveText('11');
  // Scoped to the selector: ranked on 8x2 now, the rating section links its ladder too.
  await expect(page.getByRole('navigation', { name: 'Format' }).getByRole('link', { name: '8 teams of 2' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('link', { name: 'All-time' })).toHaveAttribute('aria-current', 'page');
});

test('a Riot ID that does not resolve and a player without Arena games get their own messages', async ({ page }) => {
  await page.goto('/br/Ninguem-0000');
  await expect(page.getByTestId('not-found')).toContainText('No account named Ninguem#0000 on the Brazil server');

  await page.goto('/br/Sem%20Arena-BR1');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sem Arena#BR1');
  await expect(page.getByTestId('no-arena-games')).toHaveText('Sem Arena#BR1 has no Arena games in any season', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('not-found')).toHaveCount(0);
});

test('a profile fits a phone screen and carries the footer disclaimer', async ({ page }) => {
  await page.goto(`/br/${primary.gameName}-${primary.tagLine}?format=6x3&season=all`);
  await expect(page.getByTestId('games')).not.toHaveText('0', { timeout: 60_000 });

  await expect(page.getByRole('contentinfo')).toContainText("isn't endorsed by Riot Games");
  await expectFitsPhoneWidth(page);
});

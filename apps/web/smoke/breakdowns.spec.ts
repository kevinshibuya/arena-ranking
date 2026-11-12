import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, expectFitsPhoneWidth, test } from './fixtures';

// The champions, teammates and matches sections of the recorded player's
// profile, with every non-local host blocked: the Data Dragon icons never load.

const manifest = JSON.parse(
  readFileSync(join(__dirname, '../../fake-upstream/fixtures-anon/manifest.json'), 'utf8'),
) as { players: Array<{ gameName: string; tagLine: string; currentSeasonMatchIds: string[] }> };
const [primary, teammate] = manifest.players as [(typeof manifest.players)[number], (typeof manifest.players)[number]];
const currentSeasonGames = primary.currentSeasonMatchIds.length;
const profileUrl = `/br/${primary.gameName}-${primary.tagLine}`;

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await page.goto(profileUrl);
  await expect(page.getByTestId('games')).toHaveText(String(currentSeasonGames), { timeout: 60_000 });
});

test('the champions table counts every game, with Data Dragon names and icon URLs', async ({ page }) => {
  const table = page.getByTestId('champions');
  await expect(table).toBeVisible();

  const gamesColumn = await table.locator('tbody tr td:nth-child(2)').allTextContents();
  expect(gamesColumn.reduce((sum, games) => sum + Number(games), 0)).toBe(currentSeasonGames);
  await expect(table.locator('tbody tr').first().getByRole('rowheader')).not.toHaveText(/^Champion \d+$/);
  await expect(table.locator('img').first()).toHaveAttribute('src', /^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/.+\/img\/champion\/.+\.png$/);
});

test('a teammate link opens the teammate’s profile in the same scope', async ({ page }) => {
  const teammates = page.getByTestId('teammates');
  const link = teammates.getByRole('link', { name: `${teammate.gameName}#${teammate.tagLine}` });
  await expect(teammates.getByRole('link').first()).toHaveText(`${teammate.gameName}#${teammate.tagLine}`);

  await link.click();

  await expect(page).toHaveURL(/\/br\/Player0002-ANON\?format=6x3&season=\d+$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${teammate.gameName}#${teammate.tagLine}`);
});

test('the match list loads more until every game is shown, newest first', async ({ page }) => {
  const rows = page.getByTestId('match');
  await expect(rows).toHaveCount(20);
  const loadMore = page.getByRole('button', { name: 'Load more' });

  while (await loadMore.isVisible()) {
    const shown = await rows.count();
    await loadMore.click();
    await expect(rows).toHaveCount(Math.min(shown + 20, currentSeasonGames));
  }

  await expect(rows).toHaveCount(currentSeasonGames);
  const times = await rows.locator('time').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('datetime')!));
  expect(times).toEqual([...times].sort().reverse());
  await expect(rows.first()).toContainText(/^(1st|2nd|3rd|[4-6]th)/);
});

test('the sections fit a phone screen', async ({ page }) => {
  await expect(page.getByTestId('match').first()).toBeVisible();
  await expectFitsPhoneWidth(page);
});

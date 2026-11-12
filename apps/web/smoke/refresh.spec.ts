import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { completePlayer } from './stack';

// The update-now control on a profile. The fake holds no newer match, so a
// refresh moves the last update and leaves the numbers as they are.

const manifest = JSON.parse(
  readFileSync(join(__dirname, '../../fake-upstream/fixtures-anon/manifest.json'), 'utf8'),
) as { players: Array<{ gameName: string; tagLine: string; currentSeasonMatchIds: string[] }> };
const primary = manifest.players[0]!;
const profileUrl = `/br/${primary.gameName}-${primary.tagLine}`;

test.describe.configure({ timeout: 90_000 });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  // Settled first, so the refresh is an incremental sync and not one waiting on the primary.
  await completePlayer(primary.gameName, primary.tagLine);
});

test('update now queues a sync, shows the cooldown, and moves the last update once the sync is in', async ({ page }) => {
  await page.goto(profileUrl, { timeout: 60_000 });
  const button = page.getByRole('button', { name: 'Update now' });
  const lastUpdated = page.getByTestId('last-updated').locator('time');
  const cooldown = page.getByTestId('refresh-cooldown');
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await expect(cooldown).toHaveCount(0);
  const before = await lastUpdated.getAttribute('datetime');
  expect(before).not.toBeNull();

  await button.click();

  await expect(button).toBeDisabled();
  await expect(cooldown).toHaveText(/^Available again in [12]:\d\d$/);
  await expect(lastUpdated).not.toHaveAttribute('datetime', before!, { timeout: 30_000 });
  await expect(page.getByTestId('games')).toHaveText(String(primary.currentSeasonMatchIds.length));
});

test('a profile inside its cooldown renders the control disabled, from the server', async ({ page }) => {
  await page.goto(profileUrl);

  await expect(page.getByTestId('refresh-cooldown')).toHaveText(/^Available again in [12]:\d\d$/);
  await expect(page.getByRole('button', { name: 'Update now' })).toBeDisabled();
});

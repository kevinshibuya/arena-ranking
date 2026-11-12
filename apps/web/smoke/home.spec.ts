import { expect, expectFitsPhoneWidth, test } from './fixtures';

test('home renders its title, the search and the short Riot disclaimer linking to about', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Arena Ranking');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Arena Ranking');
  await expect(page.getByLabel('Region')).toHaveValue('br');
  await expect(page.getByRole('contentinfo')).toContainText(
    "isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games",
  );
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'About and legal' })).toHaveAttribute(
    'href',
    '/about',
  );
  await expect(page.getByRole('link', { name: 'See the 6x3 ladder' })).toHaveAttribute('href', '/ladder');
  await expectFitsPhoneWidth(page);
});

test('a malformed Riot ID is explained inline and goes nowhere', async ({ page }) => {
  await page.goto('/');
  const riotId = page.getByLabel('Riot ID');
  // Next's route announcer is an alert too.
  const problem = page.locator('form').getByRole('alert');

  await riotId.fill('Player0001');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(problem).toHaveText('Add the tag after a #, as in Name#BR1.');

  await riotId.fill('Player0001#1');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(problem).toHaveText('The tag after the # is 3 to 5 letters or digits.');
  // Home, whether the form ran in the page or, before hydration, as a GET.
  await expect(page).toHaveURL(/^[^?]*\/(\?.*)?$/);
});

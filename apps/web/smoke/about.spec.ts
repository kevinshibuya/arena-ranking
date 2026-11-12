import { expect, expectFitsPhoneWidth, test } from './fixtures';

test('about carries the full Riot disclaimer', async ({ page }) => {
  await page.goto('/about');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About');
  await expect(page.getByRole('main')).toContainText(
    "arena-ranking isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.",
  );
  await expect(page.getByRole('contentinfo')).toContainText("isn't endorsed by Riot Games");
  await expectFitsPhoneWidth(page);
});

import { test as base, expect, type Page } from '@playwright/test';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Every smoke spec imports `test` from here. It blocks any request to a
 * non-local host, so a page that needs the internet fails the smoke, and it
 * fails the test on any console error or uncaught page error. The one console
 * error it forgives is the browser's report of an image it blocked itself:
 * champion icons come from Data Dragon, and a page must render without them.
 */
export const test = base.extend<{ blockedImages: Set<string>; consoleErrors: string[] }>({
  // Playwright reads a fixture's dependencies from its first parameter's pattern; this one has none.
  // eslint-disable-next-line no-empty-pattern
  blockedImages: async ({}, use) => {
    await use(new Set());
  },
  context: async ({ context, blockedImages }, use) => {
    await context.route(
      (url) => !LOCAL_HOSTS.has(url.hostname),
      (route) => {
        if (route.request().resourceType() === 'image') blockedImages.add(route.request().url());
        return route.abort('blockedbyclient');
      },
    );
    await use(context);
  },
  consoleErrors: [
    async ({ page, blockedImages }, use) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        if (message.text().startsWith('Failed to load resource') && blockedImages.has(message.location().url)) return;
        errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await use(errors);
      expect(errors, 'console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Renders at phone width with nothing wider than the screen. */
export async function expectFitsPhoneWidth(page: Page): Promise<void> {
  await page.setViewportSize({ width: 360, height: 740 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}

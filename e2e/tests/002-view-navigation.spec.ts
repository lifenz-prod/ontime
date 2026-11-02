import { expect, test } from '@playwright/test';

test.describe('test view navigation feature', () => {
  test('user flow through links', async ({ page }) => {
    // default view is timer view
    await page.goto('http://localhost:4001/');
    page.locator('data-test-id=timer-view');

    await page.getByRole('button', { name: 'toggle menu' }).click();
    page.locator('data-test-id=navigation__menu');
    await page.getByRole('link', { name: 'Backstage' }).click();
    page.locator('data-test-id=backstage-view');
    await expect(page).toHaveURL('http://localhost:4001/backstage');

    await page.getByRole('button', { name: 'toggle menu' }).click();
    page.locator('data-test-id=navigation__menu');
    await page.getByRole('link', { name: 'Cuescreen', exact: true }).click();
    await expect(page).toHaveURL('http://localhost:4001/cuescreen');
    const errorBoundary = page.locator('data-test-id=error-container');
    await expect(errorBoundary).toHaveCount(0);

    await page.getByRole('button', { name: 'toggle menu' }).click();
    page.locator('data-test-id=navigation__menu');
    await page.getByRole('link', { name: 'Timer', exact: true }).click();
    page.locator('data-test-id=timer-view');
    await expect(page).toHaveURL('http://localhost:4001/timer');
  });
});

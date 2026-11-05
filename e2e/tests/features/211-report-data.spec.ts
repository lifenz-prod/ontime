import { expect, test } from '@playwright/test';

test('show warning when event crosses midnight', async ({ page }) => {
  await page.goto('http://localhost:4001/advanced-editor');

  await page.getByRole('button', { name: 'Clear rundown' }).click();
  await page.getByRole('button', { name: 'Delete all' }).click();

  await page.getByRole('button', { name: 'Create Event' }).click();
  await page.getByRole('button', { name: 'Event' }).nth(4).click();
  await page.getByRole('button', { name: 'Event', exact: true }).nth(1).click();
  // the rundown's end time is read-only, so place the event by its start and let the duration carry it over
  await page.getByTestId('entry-3').getByTestId('time-input-timeStart').click();
  await page.getByTestId('entry-3').getByTestId('time-input-timeStart').fill('23h');
  await page.getByTestId('entry-3').getByTestId('time-input-timeStart').press('Enter');
  await page.getByTestId('entry-3').getByTestId('time-input-duration').click();
  await page.getByTestId('entry-3').getByTestId('time-input-duration').fill('2h');
  await page.getByTestId('entry-3').getByTestId('time-input-duration').press('Enter');

  await expect(page.getByTestId('entry-3').getByTestId('event-warning')).toBeVisible();
});

test('show warning when event starts next day midnight', async ({ page }) => {
  await page.goto('http://localhost:4001/advanced-editor');

  await page.getByRole('button', { name: 'Clear rundown' }).click();
  await page.getByRole('button', { name: 'Delete all' }).click();

  await page.getByRole('button', { name: 'Create Event' }).click();
  await page.getByRole('button', { name: 'Event' }).nth(4).click();
  // end entry-2 exactly at midnight: the rundown's end time is read-only, so use start and duration
  await page.getByTestId('entry-2').getByTestId('time-input-timeStart').click();
  await page.getByTestId('entry-2').getByTestId('time-input-timeStart').fill('23h');
  await page.getByTestId('entry-2').getByTestId('time-input-timeStart').press('Enter');
  await page.getByTestId('entry-2').getByTestId('time-input-duration').click();
  await page.getByTestId('entry-2').getByTestId('time-input-duration').fill('1h');
  await page.getByTestId('entry-2').getByTestId('time-input-duration').press('Enter');
  await page.getByRole('button', { name: 'Event', exact: true }).nth(2).click();

  await expect(page.getByText('(next day)')).toBeVisible();
});

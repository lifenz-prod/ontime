import { expect, test, type Page } from '@playwright/test';

/**
 * A cue added in place takes no time (it starts where the previous one ends), so only the first
 * event gets the default 10 minutes. Give the rest the same, so each starts 10 minutes after the last.
 */
async function spaceEventsTenMinutesApart(page: Page) {
  for (const entry of ['entry-2', 'entry-3', 'entry-4']) {
    const duration = page.getByTestId(entry).getByTestId('time-input-duration');
    await duration.click();
    await duration.fill('10m');
    await duration.press('Enter');
    await expect(duration).toHaveValue('00:10:00');
  }
}

test('time until absolute', async ({ page }) => {
  await page.goto('http://localhost:4001/advanced-editor');

  await page.getByRole('button', { name: 'Clear rundown' }).click();
  await page.getByRole('button', { name: 'Delete all' }).click();

  await page.getByRole('button', { name: 'Create Event' }).click();
  await page.getByRole('button', { name: 'Event' }).nth(4).click();
  await page.getByRole('button', { name: 'Event', exact: true }).nth(1).click();
  await page.getByRole('button', { name: 'Event', exact: true }).nth(1).click();
  await spaceEventsTenMinutesApart(page);

  // the events are scheduled at midnight, so in absolute mode time-until relies on the runtime offset to
  // account for starting them late. New events count down to their end time in this fork, and those only
  // carry overtime in the offset: run the first one as a plain duration timer instead.
  await page.getByTestId('entry-1').getByTestId('block__title').click();
  const countToEnd = page.getByLabel('Countdown to Time');
  // the switch reflects the server's copy of the event, so click and wait for it rather than uncheck()
  await expect(countToEnd).toBeChecked();
  await page.getByText('Countdown to Time', { exact: true }).click();
  await expect(countToEnd).not.toBeChecked();

  await page.getByRole('button', { name: 'Absolute' }).click();
  await page.getByTestId('entry-1').getByLabel('Start event').click();
  // the overview's offset column now shows the manual global delay rather than the runtime offset, so it is not checked here
  await page.getByLabel('Pause event').click();

  await expect(page.getByTestId('entry-2').locator('#event-block')).toContainText('9m');
  await expect(page.getByTestId('entry-3').locator('#event-block')).toContainText('19m');
  await expect(page.getByTestId('entry-4').locator('#event-block')).toContainText('29m');

  await page.getByTestId('entry-1').getByTestId('time-input-duration').click();
  await page.getByTestId('entry-1').getByTestId('time-input-duration').fill('6h');
  await page.getByTestId('entry-1').getByTestId('time-input-duration').press('Enter');

  await expect(page.getByTestId('entry-2').locator('#event-block')).toContainText('5h59m');
  await expect(page.getByTestId('entry-3').locator('#event-block')).toContainText('6h9m');
  await expect(page.getByTestId('entry-4').locator('#event-block')).toContainText('6h19m');

  await page.getByTestId('entry-1').getByTestId('time-input-duration').click();
  await page.getByTestId('entry-1').getByTestId('time-input-duration').fill('30s');
  await page.getByTestId('entry-1').getByTestId('time-input-duration').press('Enter');

  await expect(page.getByTestId('entry-2').locator('#event-block')).toContainText('29s');
  await expect(page.getByTestId('entry-3').locator('#event-block')).toContainText('10m');
  await expect(page.getByTestId('entry-4').locator('#event-block')).toContainText('20m');
});

test('time until relative', async ({ page }) => {
  await page.goto('http://localhost:4001/advanced-editor');

  await page.getByRole('button', { name: 'Clear rundown' }).click();
  await page.getByRole('button', { name: 'Delete all' }).click();

  await page.getByRole('button', { name: 'Create Event' }).click();
  await page.getByRole('button', { name: 'Event' }).nth(4).click();
  await page.getByRole('button', { name: 'Event', exact: true }).nth(1).click();
  await page.getByRole('button', { name: 'Event', exact: true }).nth(1).click();
  await spaceEventsTenMinutesApart(page);

  await page.getByRole('button', { name: 'Relative' }).click();
  await page.getByTestId('entry-1').getByLabel('Start event').click();
  // the overview's offset column now shows the manual global delay rather than the runtime offset, so it is not checked here
  await page.getByLabel('Pause event').click();

  await expect(page.getByTestId('entry-2').locator('#event-block')).toContainText('9m');
  await expect(page.getByTestId('entry-3').locator('#event-block')).toContainText('19m');
  await expect(page.getByTestId('entry-4').locator('#event-block')).toContainText('29m');

  await page.getByTestId('entry-1').getByTestId('time-input-duration').click();
  await page.getByTestId('entry-1').getByTestId('time-input-duration').fill('6h');
  await page.getByTestId('entry-1').getByTestId('time-input-duration').press('Enter');

  await expect(page.getByTestId('entry-2').locator('#event-block')).toContainText('5h59m');
  await expect(page.getByTestId('entry-3').locator('#event-block')).toContainText('6h9m');
  await expect(page.getByTestId('entry-4').locator('#event-block')).toContainText('6h19m');

  await page.getByTestId('entry-1').getByTestId('time-input-duration').click();
  await page.getByTestId('entry-1').getByTestId('time-input-duration').fill('30s');
  await page.getByTestId('entry-1').getByTestId('time-input-duration').press('Enter');

  await expect(page.getByTestId('entry-2').locator('#event-block')).toContainText('29s');
  await expect(page.getByTestId('entry-3').locator('#event-block')).toContainText('10m');
  await expect(page.getByTestId('entry-4').locator('#event-block')).toContainText('20m');
});

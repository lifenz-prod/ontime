import { expect, test } from '@playwright/test';

test('message control sends messages to screens', async ({ context }) => {
  const editorPage = await context.newPage();
  const featurePage = await context.newPage();

  await editorPage.goto('http://localhost:4001/messagecontrol');

  // stage message, shown on the timer under the countdown
  await editorPage.getByPlaceholder('Message to show on cue screen').click();
  await editorPage.getByPlaceholder('Message to show on cue screen').fill('testing stage');
  await editorPage.getByRole('button', { name: /toggle stage message visibility/i }).click({ timeout: 5000 });

  await featurePage.goto('http://localhost:4001/timer');
  await featurePage.waitForLoadState('load', { timeout: 5000 });
  await expect(featurePage.getByText('testing stage')).toBeVisible();
});

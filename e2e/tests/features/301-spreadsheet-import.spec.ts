import { expect, test } from '@playwright/test';

const fileToUpload = 'e2e/tests/fixtures/test-sheet.xlsx';

test('sheet file upload', async ({ page }) => {
  await page.goto('http://localhost:4001/advanced-editor');
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Clear rundown' }).click();
  await page.getByRole('button', { name: 'Delete all' }).click();

  await page.getByRole('button', { name: 'Toggle settings' }).click();
  // the settings menu lists only its headings; spreadsheet import lives in the Import panel
  await page.getByRole('list').getByRole('button', { name: 'Import', exact: true }).click();

  // workaround to upload file on hidden input
  // https://playwright.dev/docs/api/class-filechooser
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import from spreadsheet', exact: true }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(fileToUpload);

  const worksheet = page.getByRole('row', { name: /^Worksheet/ }).getByRole('combobox');
  await worksheet.selectOption('Sheet2');
  await worksheet.selectOption('test');

  // importing applies straight away, there is no separate review step
  await page
    .getByRole('heading', { name: /Import options/ })
    .getByRole('button', { name: 'Import', exact: true })
    .click();
  // Return closes the settings as well
  await page.getByRole('button', { name: 'Return' }).click();

  // asset test events
  const firstTitle = page.getByTestId('entry-1').getByTestId('block__title');
  await expect(firstTitle).toHaveValue('Attempt light check');

  const secondTitle = page.getByTestId('entry-2').getByTestId('block__title');
  await expect(secondTitle).toHaveValue('Preset');

  const thirdTitle = page.getByTestId('entry-3').getByTestId('block__title');
  await expect(thirdTitle).toHaveValue('Albania');
});

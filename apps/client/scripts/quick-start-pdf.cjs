/**
 * Prints the Quick Start page to the PDF the page offers for download
 * usage: node apps/client/scripts/quick-start-pdf.cjs <url of /quick-start on a running dev server>
 */
const path = require('node:path');
const { chromium } = require('@playwright/test');

const url = process.argv[2] ?? 'http://localhost:3000/quick-start';
const output = path.join(__dirname, '../src/features/quick-start/assets/ontime-quick-start.pdf');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('article img').first().waitFor();
  // the query devtools button only exists in development
  await page.addStyleTag({ content: '.tsqd-open-btn-container { display: none !important; }' });
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
  await page.pdf({
    path: output,
    format: 'A4',
    margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
    printBackground: true,
  });
  await browser.close();
  console.log(`Saved ${output}`);
})();

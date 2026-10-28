/**
 * Reads Google Sheets which are shared as "anyone with the link can view"
 * This needs no authentication: we download the whole workbook from the public export endpoint
 * and read it the same way as an uploaded .xlsx file
 */

import got from 'got';
import xlsx from 'xlsx';
import type { WorkBook } from 'xlsx';

const sheetsUrl = 'https://docs.google.com/spreadsheets/d';
const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const requestTimeout = 20_000;

export type PublicWorkbook = {
  workbook: WorkBook;
  title: string;
};

/**
 * Downloads a publicly shared Google Sheet as a workbook
 * @throws if the sheet cannot be found or is not shared publicly
 */
export async function fetchPublicWorkbook(sheetId: string): Promise<PublicWorkbook> {
  const response = await got(`${sheetsUrl}/${encodeURIComponent(sheetId)}/export?format=xlsx`, {
    responseType: 'buffer',
    throwHttpErrors: false,
    timeout: { request: requestTimeout },
  });

  if (response.statusCode === 401 || response.statusCode === 403) {
    throw new Error(
      'This sheet is not shared publicly. Share it as "Anyone with the link can view", or sign in with Google.',
    );
  }
  if (response.statusCode === 404) {
    throw new Error('Could not find a Google Sheet with this link or ID');
  }
  if (response.statusCode !== 200) {
    throw new Error(`Google Sheets responded with ${response.statusCode}`);
  }
  // a sign-in page is served as html, the export is only served to us when the sheet is public
  if (!response.headers['content-type']?.includes(xlsxMime)) {
    throw new Error(
      'Could not read the sheet. Make sure it is a Google Sheet shared as "Anyone with the link can view".',
    );
  }

  const workbook = xlsx.read(response.body, { type: 'buffer', cellDates: true, cellFormula: false });
  const title = getTitleFromContentDisposition(response.headers['content-disposition']) ?? sheetId;
  return { workbook, title };
}

/**
 * Maps worksheet gids to their names, so a link to a specific tab can preselect it
 * The export does not carry gids, so we read them from the public html view
 * This is best effort: an empty list means we could not tell
 */
export async function fetchPublicWorksheetGids(sheetId: string): Promise<WorksheetGid[]> {
  try {
    const response = await got(`${sheetsUrl}/${encodeURIComponent(sheetId)}/htmlview`, {
      throwHttpErrors: false,
      timeout: { request: requestTimeout },
    });
    if (response.statusCode !== 200) {
      return [];
    }
    return parseHtmlviewWorksheets(response.body);
  } catch {
    return [];
  }
}

/**
 * Extracts the rows of a worksheet, matching its name regardless of case
 * Values are read as the formatted text shown in the sheet, as the authenticated import does
 */
export function getWorksheetRows(workbook: WorkBook, worksheet: string): unknown[][] {
  const name = workbook.SheetNames.find((sheetName) => sheetName.toLowerCase() === worksheet.toLowerCase());
  if (!name) {
    throw new Error(`Could not find worksheet: ${worksheet}`);
  }
  return xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false, raw: false });
}

/**
 * Google names the exported file after the spreadsheet
 * eg. attachment; filename="MySheet.xlsx"; filename*=UTF-8''My%20Sheet.xlsx
 */
export function getTitleFromContentDisposition(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  let filename: string | null = null;
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      filename = decodeURIComponent(encoded[1].trim());
    } catch {
      filename = null;
    }
  }
  if (!filename) {
    const plain = header.match(/filename="([^"]+)"/i);
    filename = plain ? plain[1] : null;
  }
  if (!filename) {
    return null;
  }

  const title = filename.replace(/\.xlsx$/i, '').trim();
  return title || null;
}

export type WorksheetGid = { name: string; gid: string };

/**
 * The html view lists its tabs in a script as
 * items.push({name: "Tab name", pageUrl: "...", gid: "123", ...})
 */
export function parseHtmlviewWorksheets(html: string): WorksheetGid[] {
  const worksheets: WorksheetGid[] = [];
  const itemPattern = /items\.push\(\{name: "((?:[^"\\]|\\.)*)",[^}]*?gid: "(-?\d+)"/g;
  for (const match of html.matchAll(itemPattern)) {
    worksheets.push({ name: unescapeJsString(match[1]), gid: match[2] });
  }
  return worksheets;
}

function unescapeJsString(value: string): string {
  return value
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1');
}

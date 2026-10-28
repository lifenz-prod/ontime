import { SupportedEvent } from 'ontime-types';
import { MILLIS_PER_MINUTE } from 'ontime-utils';
import { vi } from 'vitest';
import xlsx from 'xlsx';

import { parseExcel } from '../../../utils/parser.js';
import {
  fetchPublicWorkbook,
  getTitleFromContentDisposition,
  getWorksheetRows,
  parseHtmlviewWorksheets,
} from '../publicSheet.js';

const { gotMock } = vi.hoisted(() => ({ gotMock: vi.fn() }));
vi.mock('got', () => ({ default: gotMock }));

const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** a workbook with the dual service config, as a church sheet would carry it */
function makeWorkbookBuffer(): Buffer {
  const workbook = xlsx.utils.book_new();
  const morning = xlsx.utils.aoa_to_sheet([
    ['Time Start', 'Time End', 'Title', 'Timer type', 'Service boundary', 'Service offset'],
    ['07:30:00', '08:45:00', 'Rehearsal', '', '', ''],
    ['', '', 'SERVICE', 'block', 'x', ''],
    ['08:45:00', '09:00:00', 'Doors open', '', '', ''],
    ['', '', '9am', 'service', '', '00:00'],
    ['', '', '11am', 'service', '', '02:00'],
  ]);
  xlsx.utils.book_append_sheet(workbook, morning, 'Morning');
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['Title'], ['Evening thing']]), 'Evening');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function mockResponse(statusCode: number, body: Buffer | string, headers: Record<string, string> = {}) {
  gotMock.mockResolvedValueOnce({ statusCode, body, headers });
}

describe('fetchPublicWorkbook()', () => {
  beforeEach(() => {
    gotMock.mockReset();
  });

  test('reads all worksheets and the title of a public sheet', async () => {
    mockResponse(200, makeWorkbookBuffer(), {
      'content-type': xlsxMime,
      'content-disposition': `attachment; filename="SundayRundown.xlsx"; filename*=UTF-8''Sunday%20Rundown.xlsx`,
    });

    const { workbook, title } = await fetchPublicWorkbook('sheet-id-1234567890abcdef');
    expect(title).toBe('Sunday Rundown');
    expect(workbook.SheetNames).toStrictEqual(['Morning', 'Evening']);
    expect(gotMock.mock.calls[0][0]).toBe(
      'https://docs.google.com/spreadsheets/d/sheet-id-1234567890abcdef/export?format=xlsx',
    );
  });

  test('falls back to the sheet ID for the title', async () => {
    mockResponse(200, makeWorkbookBuffer(), { 'content-type': xlsxMime });
    const { title } = await fetchPublicWorkbook('sheet-id-1234567890abcdef');
    expect(title).toBe('sheet-id-1234567890abcdef');
  });

  test('explains a sheet which is not shared publicly', async () => {
    mockResponse(401, '<html></html>', { 'content-type': 'text/html' });
    await expect(fetchPublicWorkbook('private')).rejects.toThrow('not shared publicly');
  });

  test('explains a sheet which does not exist', async () => {
    mockResponse(404, '<html></html>', { 'content-type': 'text/html' });
    await expect(fetchPublicWorkbook('missing')).rejects.toThrow('Could not find a Google Sheet');
  });

  test('does not try to read a sign-in page as a workbook', async () => {
    mockResponse(200, '<html>Sign in</html>', { 'content-type': 'text/html' });
    await expect(fetchPublicWorkbook('login')).rejects.toThrow('Anyone with the link can view');
  });
});

describe('public sheet rows', () => {
  test('keep the dual service config through the shared parser', () => {
    const workbook = xlsx.read(makeWorkbookBuffer(), { type: 'buffer', cellDates: true, cellFormula: false });
    // worksheet names match regardless of case, as with the authenticated import
    const rows = getWorksheetRows(workbook, 'morning');

    const result = parseExcel(
      rows,
      {},
      {
        worksheet: 'morning',
        timeStart: 'time start',
        timeEnd: 'time end',
        title: 'title',
        timerType: 'timer type',
        serviceBoundary: 'service boundary',
        serviceOffset: 'service offset',
        custom: {},
      },
    );

    expect(result.rundown.length).toBe(3);
    expect(result.rundown.at(1)?.type).toBe(SupportedEvent.Block);
    expect(result.serviceProfiles.boundaryBlockId).toBe(result.rundown.at(1)?.id);
    expect(result.serviceProfiles.services).toMatchObject([
      { name: '9am', offset: 0 },
      { name: '11am', offset: 2 * 60 * MILLIS_PER_MINUTE },
    ]);
  });

  test('throws for an unknown worksheet', () => {
    const workbook = xlsx.read(makeWorkbookBuffer(), { type: 'buffer' });
    expect(() => getWorksheetRows(workbook, 'Afternoon')).toThrow('Could not find worksheet: Afternoon');
  });
});

describe('getTitleFromContentDisposition()', () => {
  test('prefers the encoded filename', () => {
    expect(
      getTitleFromContentDisposition(
        `attachment; filename="Kia ora.xlsx"; filename*=UTF-8''Kia%20ora%20%E2%80%93%20AM.xlsx`,
      ),
    ).toBe('Kia ora – AM');
  });

  test('reads a plain filename', () => {
    expect(getTitleFromContentDisposition('attachment; filename="Rundown.xlsx"')).toBe('Rundown');
  });

  test('handles a missing header', () => {
    expect(getTitleFromContentDisposition(undefined)).toBeNull();
    expect(getTitleFromContentDisposition('attachment')).toBeNull();
  });
});

describe('parseHtmlviewWorksheets()', () => {
  test('maps tab names to gids', () => {
    const html = `<script>var items = [];
items.push({name: "CENTRAL AM", pageUrl: "https:\\/\\/docs.google.com\\/x?gid\\x3d0", gid: "0",initialSheet: ("0" == gid)});
items.push({name: "Rock \\x26 Roll \\"PM\\"", pageUrl: "https:\\/\\/docs.google.com\\/y", gid: "18273645",initialSheet: ("18273645" == gid)});
</script>`;
    expect(parseHtmlviewWorksheets(html)).toStrictEqual([
      { name: 'CENTRAL AM', gid: '0' },
      { name: 'Rock & Roll "PM"', gid: '18273645' },
    ]);
  });

  test('returns nothing for an unexpected page', () => {
    expect(parseHtmlviewWorksheets('<html>Sign in</html>')).toStrictEqual([]);
  });
});

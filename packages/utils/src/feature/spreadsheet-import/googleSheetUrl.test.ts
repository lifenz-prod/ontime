import { parseGoogleSheetInput } from './googleSheetUrl.js';

const id = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

describe('parseGoogleSheetInput()', () => {
  test('accepts a bare sheet ID', () => {
    expect(parseGoogleSheetInput(id)).toStrictEqual({ sheetId: id, gid: null });
  });

  test('ignores surrounding whitespace', () => {
    expect(parseGoogleSheetInput(`  ${id}\n`)).toStrictEqual({ sheetId: id, gid: null });
  });

  test('extracts the ID from an edit link', () => {
    expect(parseGoogleSheetInput(`https://docs.google.com/spreadsheets/d/${id}/edit`)).toStrictEqual({
      sheetId: id,
      gid: null,
    });
  });

  test('extracts the gid from the hash', () => {
    expect(parseGoogleSheetInput(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=123456`)).toStrictEqual({
      sheetId: id,
      gid: '123456',
    });
  });

  test('extracts the gid from the query', () => {
    expect(
      parseGoogleSheetInput(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing&gid=0#gid=0`),
    ).toStrictEqual({ sheetId: id, gid: '0' });
  });

  test('handles links without a protocol or with an account segment', () => {
    expect(parseGoogleSheetInput(`docs.google.com/spreadsheets/u/1/d/${id}/htmlview`)).toStrictEqual({
      sheetId: id,
      gid: null,
    });
    expect(parseGoogleSheetInput(`docs.google.com/spreadsheets/d/${id}`)).toStrictEqual({ sheetId: id, gid: null });
  });

  test('rejects links to sheets published to the web', () => {
    expect(parseGoogleSheetInput('https://docs.google.com/spreadsheets/d/e/2PACX-1vabc/pubhtml')).toBeNull();
  });

  test('rejects things that are not sheets', () => {
    expect(parseGoogleSheetInput('')).toBeNull();
    expect(parseGoogleSheetInput('my sheet')).toBeNull();
    expect(parseGoogleSheetInput('https://example.com')).toBeNull();
    expect(parseGoogleSheetInput('short-id')).toBeNull();
  });
});

import { ImportCustom } from 'ontime-utils';

import { convertToImportMap, NamedImportMap, pickWorksheet } from '../importMapUtils';

describe('convertToImportMap', () => {
  it('converts a namedImportMap to a importMap', () => {
    const defaultNamedImporMap = {
      Worksheet: 'event schedule',
      Start: 'time start',
      'Link start': 'link start',
      End: 'time end',
      Duration: 'duration',
      Cue: 'cue',
      Title: 'title',
      'Is Public': 'public',
      Skip: 'skip',
      Note: 'notes',
      Colour: 'colour',
      'End action': 'end action',
      'Timer type': 'timer type',
      'Time warning': 'warning time',
      'Time danger': 'danger time',
      custom: [
        { ontimeName: 'Custom1        ', importName: 'custom1' },
        { ontimeName: 'Custom2', importName: 'custom2' },
        { ontimeName: 'Custom3', importName: 'custom3' },
        { ontimeName: 'EmptyImportName', importName: '' },
        { ontimeName: '', importName: 'EmptyOntimeName' },
      ] as ImportCustom[],
    } as NamedImportMap;

    const importMap = convertToImportMap(defaultNamedImporMap);
    expect(importMap.custom).toStrictEqual({
      Custom1: 'custom1',
      Custom2: 'custom2',
      Custom3: 'custom3',
    });
  });
});

describe('pickWorksheet()', () => {
  const names = ['Rehearsal', 'CENTRAL AM', 'CENTRAL PM'];

  test('prefers the worksheet the link pointed to', () => {
    expect(pickWorksheet(names, 'CENTRAL PM', 'central am')).toBe('CENTRAL PM');
  });

  test('then the worksheet used last, matching its case to the sheet', () => {
    expect(pickWorksheet(names, null, 'central am')).toBe('CENTRAL AM');
  });

  test('then the first worksheet', () => {
    expect(pickWorksheet(names, null, 'event schedule')).toBe('Rehearsal');
  });

  test('keeps the last worksheet until worksheets are known', () => {
    expect(pickWorksheet(null, null, 'event schedule')).toBe('event schedule');
  });
});

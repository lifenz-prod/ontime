import { describe, expect, it } from 'vitest';

import { getViewUrl, makeDefaultConfig, normaliseConfig, normaliseServerUrl } from './config.js';

describe('normaliseServerUrl()', () => {
  it.each([
    ['192.168.1.10:4001', 'http://192.168.1.10:4001'],
    ['http://192.168.1.10:4001/', 'http://192.168.1.10:4001'],
    ['http://ontime.local:4001/editor?x=1', 'http://ontime.local:4001'],
    ['  https://ontime.example  ', 'https://ontime.example'],
  ])('turns %s into %s', (value, expected) => {
    expect(normaliseServerUrl(value)).toBe(expected);
  });

  it.each([[''], ['   '], ['ftp://host'], [undefined], [42]])('rejects %s', (value) => {
    expect(normaliseServerUrl(value)).toBeNull();
  });
});

describe('normaliseConfig()', () => {
  it('gives the defaults for nothing', () => {
    expect(normaliseConfig(undefined)).toEqual(makeDefaultConfig());
    expect(normaliseConfig('nonsense')).toEqual(makeDefaultConfig());
  });

  it('always has two outputs', () => {
    expect(normaliseConfig({ outputs: [] }).outputs).toHaveLength(2);
    expect(normaliseConfig({ outputs: [{}, {}, {}] }).outputs).toHaveLength(2);
  });

  it('keeps valid values and repairs the rest', () => {
    const config = normaliseConfig({
      serverUrl: '10.0.0.5:4001',
      outputs: [
        {
          enabled: true,
          name: '  Stage Left  ',
          view: '/cuescreennow/',
          query: '?hideClock=true',
          width: 99999,
          height: 'abc',
          frameRate: 0,
          transparent: true,
        },
      ],
    });

    expect(config.serverUrl).toBe('http://10.0.0.5:4001');
    expect(config.outputs[0]).toEqual({
      enabled: true,
      name: 'Stage Left',
      view: 'cuescreennow',
      query: 'hideClock=true',
      width: 7680,
      height: 1080,
      frameRate: 1,
      transparent: true,
    });
    expect(config.outputs[1]).toEqual(makeDefaultConfig().outputs[1]);
  });

  it('drops a query or hash typed into the view', () => {
    const config = normaliseConfig({ outputs: [{ view: 'cuescreen?a=1#b' }] });
    expect(config.outputs[0].view).toBe('cuescreen');
  });

  it('never lets two outputs share a Syphon name', () => {
    const config = normaliseConfig({ outputs: [{ name: 'Cue' }, { name: 'Cue' }] });
    expect(config.outputs[0].name).toBe('Cue');
    expect(config.outputs[1].name).toBe('Cue (2)');
  });
});

describe('getViewUrl()', () => {
  it('joins the server, view and options', () => {
    const output = { view: 'cuescreen', query: 'hideClock=true&size=2' };
    expect(getViewUrl('http://10.0.0.5:4001', output)).toBe('http://10.0.0.5:4001/cuescreen?hideClock=true&size=2');
  });

  it('leaves out an empty query', () => {
    expect(getViewUrl('http://10.0.0.5:4001', { view: 'qlabcountdown', query: '' })).toBe(
      'http://10.0.0.5:4001/qlabcountdown',
    );
  });
});

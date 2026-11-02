import { compareVersions, isPrerelease, parseVersion } from './compareVersions';

describe('compareVersions()', () => {
  test.each([
    ['4.0.2', '4.0.1', 1],
    ['4.0.1', '4.0.2', -1],
    ['v4.0.2', '4.0.2', 0],
    ['4.1.0', '4.0.9', 1],
    ['5.0.0', '4.9.9', 1],
    ['4.0.2', '4.0.2-beta.6', 1],
    ['4.0.2-beta.6', '4.0.2', -1],
    ['4.0.2-beta.7', '4.0.2-beta.6', 1],
    ['4.0.2-beta.10', '4.0.2-beta.9', 1],
    ['4.0.3-beta.0', '4.0.2', 1],
    ['4.0.2-beta', '4.0.2-beta.1', -1],
  ])('%s against %s', (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected);
  });

  test('unreadable versions are not ordered', () => {
    expect(compareVersions('nightly', '4.0.2')).toBe(0);
  });
});

describe('isPrerelease()', () => {
  test('betas are prereleases', () => {
    expect(isPrerelease('v4.0.2-beta.6')).toBe(true);
    expect(isPrerelease('4.0.2')).toBe(false);
  });
});

describe('parseVersion()', () => {
  test('reads tags with or without the v', () => {
    expect(parseVersion('v4.0.2-beta.6')).toEqual({ core: [4, 0, 2], prerelease: ['beta', 6] });
    expect(parseVersion('not a version')).toBeNull();
  });
});

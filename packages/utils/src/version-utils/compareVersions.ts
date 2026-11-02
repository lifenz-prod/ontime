type ParsedVersion = { core: number[]; prerelease: (number | string)[] };

/**
 * Parses versions as tagged in releases, eg. v4.0.2 or 4.0.2-beta.6
 */
export function parseVersion(version: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version.trim());
  if (!match) {
    return null;
  }
  const [, major, minor, patch, prerelease] = match;
  return {
    core: [Number(major), Number(minor), Number(patch)],
    prerelease: prerelease ? prerelease.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : [],
  };
}

/**
 * Orders two versions following semver precedence, where a beta comes before its release
 * @returns a negative number if a is older, positive if a is newer, 0 if equal or unreadable
 */
export function compareVersions(a: string, b: string): number {
  const first = parseVersion(a);
  const second = parseVersion(b);
  if (!first || !second) {
    return 0;
  }

  for (let i = 0; i < 3; i++) {
    if (first.core[i] !== second.core[i]) {
      return first.core[i] - second.core[i];
    }
  }

  // a release is newer than any of its prereleases
  if (!first.prerelease.length || !second.prerelease.length) {
    return second.prerelease.length - first.prerelease.length;
  }

  const length = Math.max(first.prerelease.length, second.prerelease.length);
  for (let i = 0; i < length; i++) {
    const left = first.prerelease[i];
    const right = second.prerelease[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    // numeric identifiers sort before alphanumeric ones
    if (typeof left === 'number') return -1;
    if (typeof right === 'number') return 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

export function isPrerelease(version: string): boolean {
  return Boolean(parseVersion(version)?.prerelease.length);
}

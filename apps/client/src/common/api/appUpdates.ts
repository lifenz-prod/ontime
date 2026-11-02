import { compareVersions } from 'ontime-utils';

import { githubUrl } from '../../externals';

const releasesApi = 'https://api.github.com/repos/lifenz-prod/ontime/releases?per_page=30';

export type AppRelease = {
  tag: string;
  version: string;
  isBeta: boolean;
  notes: string;
  url: string;
  publishedAt: string;
};

type GithubRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
};

/**
 * Finds the newest published release, betas included only when opted in
 */
export async function getLatestRelease(includeBeta: boolean): Promise<AppRelease | null> {
  const response = await fetch(releasesApi, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) {
    throw new Error(`Could not reach GitHub (${response.status})`);
  }
  const releases: GithubRelease[] = await response.json();

  const newest = releases
    .filter((release) => !release.draft && (includeBeta || !release.prerelease))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];

  if (!newest) {
    return null;
  }

  return {
    tag: newest.tag_name,
    version: newest.tag_name.replace(/^v/, ''),
    isBeta: newest.prerelease,
    notes: newest.body?.trim() ?? '',
    url: newest.html_url || `${githubUrl}/releases/tag/${newest.tag_name}`,
    publishedAt: newest.published_at,
  };
}

const betaOptInKey = 'ontime-updates-beta';

export function getBetaOptIn(): boolean {
  try {
    return localStorage.getItem(betaOptInKey) === 'true';
  } catch {
    return false;
  }
}

export function setBetaOptIn(optIn: boolean) {
  try {
    localStorage.setItem(betaOptInKey, String(optIn));
  } catch {
    /** the choice just won't be remembered */
  }
}

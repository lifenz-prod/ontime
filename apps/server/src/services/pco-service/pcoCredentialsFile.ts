/**
 * Stores the Planning Center token pair entered in the settings panel.
 *
 * A campus without a shell to export variables from needs somewhere to keep these,
 * so they go in the Ontime data directory next to the Google Sheets auth, which is
 * the same class of secret and already kept there.
 *
 * Three rules this module exists to hold in one place:
 *
 * 1. The secret is never logged and never leaves the server. Only presence and a
 *    masked application id are reported.
 * 2. The file is written 0600. It is a bearer credential for the organisation's
 *    whole Services product.
 * 3. It lives in the data directory, NOT in the project file. A project gets
 *    exported, mailed around and committed; a token must not travel with it.
 */

import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { LogOrigin } from 'ontime-types';

import { logger } from '../../classes/Logger.js';
import { publicDir } from '../../setup/index.js';

import type { PcoCredentials } from './PcoClient.js';

export const pcoCredentialsPath = join(publicDir.root, 'pco-credentials.json');

/** owner read/write only */
const SECRET_FILE_MODE = 0o600;

/**
 * The stored pair, or null when nothing is saved or the file is unreadable.
 * A malformed file is logged without its contents and treated as absent, so a
 * broken file cannot take the server down or leak into a log.
 */
export function readStoredCredentials(): PcoCredentials | null {
  if (!existsSync(pcoCredentialsPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(pcoCredentialsPath, 'utf-8'));
    const applicationId = typeof parsed?.applicationId === 'string' ? parsed.applicationId.trim() : '';
    const secret = typeof parsed?.secret === 'string' ? parsed.secret.trim() : '';

    return applicationId && secret ? { applicationId, secret } : null;
  } catch {
    // deliberately not including the error: it can quote the file
    logger.error(LogOrigin.Server, `Could not read Planning Center credentials at ${pcoCredentialsPath}`);
    return null;
  }
}

export function hasStoredCredentials(): boolean {
  return readStoredCredentials() !== null;
}

export function writeStoredCredentials(credentials: PcoCredentials): void {
  const contents = {
    '//': 'Planning Center token pair, written by the Ontime settings panel. Keep this file private.',
    applicationId: credentials.applicationId.trim(),
    secret: credentials.secret.trim(),
  };

  writeFileSync(pcoCredentialsPath, `${JSON.stringify(contents, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: SECRET_FILE_MODE,
  });

  try {
    // the mode above only applies when the file is created, so an existing file
    // with looser permissions is tightened here. A no-op on Windows.
    chmodSync(pcoCredentialsPath, SECRET_FILE_MODE);
  } catch {
    /** best effort: the platform may not support it */
  }

  logger.info(LogOrigin.Server, 'Saved Planning Center credentials');
}

export function clearStoredCredentials(): void {
  if (existsSync(pcoCredentialsPath)) {
    rmSync(pcoCredentialsPath);
    logger.info(LogOrigin.Server, 'Removed Planning Center credentials');
  }
}

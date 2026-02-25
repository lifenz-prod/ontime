/**
 * Service aggregates business logic related
 * to integration with Google Sheets API
 * @link https://developers.google.com/identity/protocols/oauth2/limited-input-device
 */

import { AuthenticationStatus, CustomFields, LogOrigin, MaybeString, OntimeRundown } from 'ontime-types';
import { ImportMap, getErrorMessage } from 'ontime-utils';

import { sheets, type sheets_v4 } from '@googleapis/sheets';
import { Credentials, OAuth2Client } from 'google-auth-library';
import got from 'got';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

import { parseExcel } from '../../utils/parser.js';
import { logger } from '../../classes/Logger.js';
import { parseRundown } from '../../utils/parserFunctions.js';
import { getRundown } from '../rundown-service/rundownUtils.js';
import { getCustomFields } from '../rundown-service/rundownCache.js';
import { publicDir, publicFiles } from '../../setup/index.js';
import { ensureDirectory } from '../../utils/fileManagement.js';

import { cellRequestFromEvent, type ClientSecret, getA1Notation, validateClientSecret } from './sheetUtils.js';

const sheetScope = 'https://www.googleapis.com/auth/spreadsheets';
const codesUrl = 'https://oauth2.googleapis.com/device/code';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const grantType = 'urn:ietf:params:oauth:grant-type:device_code';

type PersistedCredentials = Pick<
  Credentials,
  'access_token' | 'refresh_token' | 'expiry_date' | 'scope' | 'token_type'
>;

type PersistedSheetsState = {
  clientSecret: ClientSecret | null;
  sheetId: MaybeString;
  credentials: PersistedCredentials | null;
};

const defaultState: PersistedSheetsState = {
  clientSecret: null,
  sheetId: null,
  credentials: null,
};

const adapter = new JSONFile<PersistedSheetsState>(publicFiles.sheetsState);
const storage = new Low<PersistedSheetsState>(adapter, defaultState);

let currentAuthClient: OAuth2Client | null = null;
let currentClientSecret: ClientSecret | null = null;
let currentAuthUrl: MaybeString = null;
let currentAuthCode: MaybeString = null;

let currentSheetId: MaybeString = null;

let pollInterval: NodeJS.Timeout | null = null;
let cleanupTimeout: NodeJS.Timeout | null = null;

function clearActiveTimers() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  if (cleanupTimeout) {
    clearTimeout(cleanupTimeout);
    cleanupTimeout = null;
  }
}

function resetMemoryState() {
  currentAuthClient = null;
  currentClientSecret = null;
  currentAuthUrl = null;
  currentAuthCode = null;
  currentSheetId = null;

  clearActiveTimers();
}

async function readPersistedState(): Promise<PersistedSheetsState> {
  await storage.read();
  return {
    ...defaultState,
    ...storage.data,
  };
}

async function writePersistedState(patch: Partial<PersistedSheetsState>) {
  const existing = await readPersistedState();
  storage.data = {
    ...existing,
    ...patch,
  };
  await storage.write();
}

function getPersistedCredentials(client: OAuth2Client): PersistedCredentials {
  return {
    access_token: client.credentials.access_token,
    refresh_token: client.credentials.refresh_token,
    expiry_date: client.credentials.expiry_date,
    scope: client.credentials.scope,
    token_type: client.credentials.token_type,
  };
}

async function persistCurrentState() {
  await writePersistedState({
    clientSecret: currentClientSecret,
    sheetId: currentSheetId,
    credentials: currentAuthClient ? getPersistedCredentials(currentAuthClient) : null,
  });
}

async function persistCurrentStateSafe() {
  try {
    await persistCurrentState();
  } catch (error) {
    logger.warning(LogOrigin.Server, `Could not persist Google Sheets auth state: ${getErrorMessage(error)}`);
  }
}

function attachTokenUpdates(client: OAuth2Client) {
  client.on('tokens', async (tokens) => {
    // only persist updates from the active client
    if (currentAuthClient !== client) {
      return;
    }

    client.setCredentials({
      ...client.credentials,
      ...tokens,
      // refresh tokens are generally only returned on the first grant,
      // so keep the existing value on refresh events
      refresh_token: tokens.refresh_token ?? client.credentials.refresh_token,
    });

    await persistCurrentStateSafe();
  });
}

/**
 * Initialise module
 */
export async function init() {
  resetMemoryState();
  ensureDirectory(publicDir.sheetsDir);

  try {
    const persistedState = await readPersistedState();
    currentClientSecret = persistedState.clientSecret;
    currentSheetId = persistedState.sheetId;

    if (!persistedState.clientSecret || !persistedState.credentials) {
      return;
    }

    const client = new OAuth2Client({
      clientId: persistedState.clientSecret.installed.client_id,
      clientSecret: persistedState.clientSecret.installed.client_secret,
    });

    client.setCredentials(persistedState.credentials);
    attachTokenUpdates(client);

    // triggers refresh when needed and validates persisted credentials
    await client.getAccessToken();

    currentAuthClient = client;
    await persistCurrentStateSafe();
    logger.info(LogOrigin.Server, 'Google Sheets authentication restored from disk');
  } catch (error) {
    logger.warning(LogOrigin.Server, `Google Sheets re-authentication failed: ${getErrorMessage(error)}`);
    currentAuthClient = null;
    await persistCurrentStateSafe();
  }
}

/**
 * Resets all state related to an eventual connection
 */
export async function revoke(): Promise<ReturnType<typeof hasAuth>> {
  resetMemoryState();
  await writePersistedState(defaultState);
  return hasAuth();
}

/**
 * Parses and validates a client secret string
 * @param clientSecret
 * @returns
 */
export function handleClientSecret(clientSecret: string): ClientSecret {
  const clientSecretObject = JSON.parse(clientSecret);

  try {
    validateClientSecret(clientSecretObject);
  } catch (error) {
    throw new Error(`Client secret is invalid: ${error}`);
  }

  return clientSecretObject;
}

// https://developers.google.com/identity/protocols/oauth2/limited-input-device#success-response
type CodesResponse = {
  device_code: string;
  expires_in: number;
  interval: number;
  user_code: string;
  verification_url: string;
};

/**
 * Establishes connection with Google Auth server
 * and retrieves device codes
 * @param clientSecret
 * @returns
 */
async function getDeviceCodes(clientSecret: ClientSecret): Promise<CodesResponse> {
  const deviceCodes: CodesResponse = await got
    .post(codesUrl, {
      json: {
        client_id: clientSecret.installed.client_id,
        scope: sheetScope,
      },
    })
    .json();

  return deviceCodes;
}

/**
 * Gets credentials from Google Auth server
 */
function verifyConnection(
  clientSecret: ClientSecret,
  device_code: string,
  interval: number,
  expires_in: number,
  postAction: () => Promise<any>,
) {
  // create poller to check for auth
  pollInterval = setInterval(pollForAuth, interval * 1000);

  // schedule to clear the poller when we know the token is no longer valid
  if (cleanupTimeout) {
    clearTimeout(cleanupTimeout);
    cleanupTimeout = null;
  }
  cleanupTimeout = setTimeout(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }, expires_in * 1000);

  async function pollForAuth() {
    // server returns 428 if user hasnt yet completed the auth process
    try {
      logger.info(LogOrigin.Server, 'Polling for auth...');
      const auth: Credentials = await got
        .post(tokenUrl, {
          json: {
            client_id: clientSecret.installed.client_id,
            client_secret: clientSecret.installed.client_secret,
            device_code,
            grant_type: grantType,
          },
        })
        .json();

      logger.info(LogOrigin.Server, 'Successfully Authenticated');
      const client = new OAuth2Client({
        clientId: clientSecret.installed.client_id,
        clientSecret: clientSecret.installed.client_secret,
      });

      client.setCredentials({
        refresh_token: auth.refresh_token,
        access_token: auth.access_token,
        expiry_date: auth.expiry_date,
        scope: auth.scope,
        token_type: auth.token_type,
      });
      attachTokenUpdates(client);

      // save client and cancel tasks
      currentAuthClient = client;

      clearActiveTimers();

      await persistCurrentStateSafe();
      await postAction();
    } catch (_error) {
      /** we do not handle failure */
    }
  }
}

export function hasAuth(): { authenticated: AuthenticationStatus; sheetId: string } {
  if (cleanupTimeout) {
    return { authenticated: 'pending', sheetId: currentSheetId ?? '' };
  }
  return { authenticated: currentAuthClient ? 'authenticated' : 'not_authenticated', sheetId: currentSheetId ?? '' };
}

async function verifySheet(
  sheetId = currentSheetId,
  authClient = currentAuthClient,
): Promise<{ worksheetOptions: string[] }> {
  try {
    const spreadsheets = await sheets({ version: 'v4', auth: authClient }).spreadsheets.get({
      spreadsheetId: sheetId,
      includeGridData: false,
    });
    return { worksheetOptions: spreadsheets.data.sheets.map((i) => i.properties.title) };
  } catch (error) {
    // attempt to catch errors caused by importing xlsx
    if (
      error.code === 400 &&
      Array.isArray(error.errors) &&
      error.errors[0].reason === 'failedPrecondition' &&
      error.errors[0].message === 'This operation is not supported for this document'
    ) {
      throw new Error('Cannot read the linked file as a Google Sheet. It may be an .xlsx file instead.');
    }
    const errorMessage = getErrorMessage(error);
    throw new Error(`Failed to verify sheet: ${errorMessage}`);
  }
}

export async function handleInitialConnection(
  clientSecret: ClientSecret,
  sheetId: string,
): Promise<{ verification_url: string; user_code: string }> {
  // TODO: check if the clientSecret has changed
  currentClientSecret = clientSecret;

  // we know there is an ongoing process if there is a timeout for cleanup
  // if there is an ongoing process, we return its data
  if (cleanupTimeout) {
    return { verification_url: currentAuthUrl, user_code: currentAuthCode };
  }

  const { device_code, expires_in, interval, user_code, verification_url } = await getDeviceCodes(currentClientSecret);
  currentAuthUrl = verification_url;
  currentAuthCode = user_code;
  currentSheetId = sheetId;
  await persistCurrentStateSafe();

  // schedule verifying token and the existence of the sheetID
  verifyConnection(currentClientSecret, device_code, interval, expires_in, verifySheet);

  return { verification_url, user_code };
}

/**
 * Allow calling verification for sheetId
 * @returns
 */
export async function getWorksheetOptions(sheetId: string): ReturnType<typeof verifySheet> {
  if (!currentAuthClient) {
    throw new Error('Not authenticated');
  }
  currentSheetId = sheetId;
  await persistCurrentStateSafe();

  return verifySheet(sheetId);
}

async function verifyWorksheet(sheetId: string, worksheet: string): Promise<{ worksheetId: number; range: string }> {
  currentSheetId = sheetId;
  await persistCurrentStateSafe();

  const spreadsheets = await sheets({ version: 'v4', auth: currentAuthClient }).spreadsheets.get({
    spreadsheetId: sheetId,
  });

  if (spreadsheets.status !== 200) {
    throw new Error(`Request failed: ${spreadsheets.status} ${spreadsheets.statusText}`);
  }

  const selectedWorksheet = spreadsheets.data.sheets.find(
    (n) => n.properties.title.toLowerCase() === worksheet.toLowerCase(),
  );

  if (!selectedWorksheet) {
    throw new Error('Could not find worksheet');
  }

  const endCell = getA1Notation(
    selectedWorksheet.properties.gridProperties.rowCount,
    selectedWorksheet.properties.gridProperties.columnCount,
  );
  return { worksheetId: selectedWorksheet.properties.sheetId, range: `${worksheet}!A1:${endCell}` };
}

export async function upload(sheetId: string, options: ImportMap) {
  const { worksheetId, range } = await verifyWorksheet(sheetId, options.worksheet);

  const readResponse = await sheets({ version: 'v4', auth: currentAuthClient }).spreadsheets.values.get({
    spreadsheetId: sheetId,
    valueRenderOption: 'FORMATTED_VALUE',
    majorDimension: 'ROWS',
    range,
  });

  if (readResponse.status !== 200) {
    throw new Error(`Sheet read failed: ${readResponse.statusText}`);
  }

  const { rundownMetadata } = parseExcel(readResponse.data.values, getCustomFields(), options);
  const rundown = getRundown();
  const titleRow = Object.values(rundownMetadata)[0]['row'];
  const updateRundown = Array<sheets_v4.Schema$Request>();

  // we can't delete the last unfrozen row so we create an empty one
  updateRundown.push({
    insertDimension: {
      inheritFromBefore: false,
      range: {
        dimension: 'ROWS',
        startIndex: titleRow + 1,
        endIndex: titleRow + 2,
        sheetId: worksheetId,
      },
    },
  });

  // ... and delete the rest
  updateRundown.push({
    deleteDimension: { range: { dimension: 'ROWS', startIndex: titleRow + 2, sheetId: worksheetId } },
  });

  // insert the length of the rundown
  updateRundown.push({
    insertDimension: {
      inheritFromBefore: false,
      range: {
        dimension: 'ROWS',
        startIndex: titleRow + 1,
        endIndex: titleRow + rundown.length,
        sheetId: worksheetId,
      },
    },
  });

  // update the corresponding row with event data
  rundown.forEach((entry, index) =>
    updateRundown.push(cellRequestFromEvent(entry, index, worksheetId, rundownMetadata)),
  );

  const writeResponse = await sheets({ version: 'v4', auth: currentAuthClient }).spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      includeSpreadsheetInResponse: false,
      responseRanges: [range],
      requests: updateRundown,
    },
  });

  if (writeResponse.status === 200) {
    logger.info(LogOrigin.Server, `Sheet write ${writeResponse.statusText}`);
  } else {
    throw new Error(`Sheet write failed: ${writeResponse.statusText}`);
  }
}

export async function download(
  sheetId: string,
  options: ImportMap,
): Promise<{
  rundown: OntimeRundown;
  customFields: CustomFields;
}> {
  const { range } = await verifyWorksheet(sheetId, options.worksheet);

  const googleResponse = await sheets({ version: 'v4', auth: currentAuthClient }).spreadsheets.values.get({
    spreadsheetId: sheetId,
    valueRenderOption: 'FORMATTED_VALUE',
    majorDimension: 'ROWS',
    range,
  });

  if (googleResponse.status !== 200) {
    throw new Error(`Sheet read failed: ${googleResponse.statusText}`);
  }

  const dataFromSheet = parseExcel(googleResponse.data.values, getCustomFields(), options);
  const { customFields, rundown } = parseRundown(dataFromSheet);
  if (rundown.length < 1) {
    throw new Error('Sheet: Could not find data to import in the worksheet');
  }
  return { rundown, customFields };
}

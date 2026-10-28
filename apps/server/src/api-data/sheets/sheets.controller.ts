/**
 * This module encapsulates logic related to
 * Google Sheets
 */

import { Request, Response } from 'express';
import { readFileSync } from 'fs';

import type {
  AuthenticationStatus,
  CustomFields,
  ErrorResponse,
  OntimeRundown,
  PublicSheetInfo,
  RecentSheet,
} from 'ontime-types';

import { deleteFile } from '../../utils/parserUtils.js';
import {
  revoke,
  handleClientSecret,
  handleInitialConnection,
  hasAuth,
  download,
  upload,
  getWorksheetOptions,
  openPublicSheet,
  downloadPublic,
  getRecentSheets,
} from '../../services/sheet-service/SheetService.js';
import { getErrorMessage, parseGoogleSheetInput } from 'ontime-utils';

export async function requestConnection(
  req: Request,
  res: Response<{ verification_url: string; user_code: string } | ErrorResponse>,
) {
  const { sheetId } = req.params;
  const file = req.file.path;

  try {
    const client = readFileSync(file, 'utf-8');
    const clientSecret = handleClientSecret(client);
    const { verification_url, user_code } = await handleInitialConnection(clientSecret, sheetId);

    res.status(200).send({ verification_url, user_code });
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }

  // delete uploaded file after parsing
  try {
    deleteFile(file);
  } catch (_error) {
    /** we dont handle failure here */
  }
}

export async function verifyAuthentication(
  _req: Request,
  res: Response<{ authenticated: AuthenticationStatus; sheetId: string } | ErrorResponse>,
) {
  try {
    const authenticated = hasAuth();
    res.status(200).send(authenticated);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

export async function revokeAuthentication(
  _req: Request,
  res: Response<{ authenticated: AuthenticationStatus; sheetId: string } | ErrorResponse>,
) {
  try {
    const authenticated = await revoke();
    res.status(200).send(authenticated);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

export async function getWorksheetNamesFromSheet(req: Request, res: Response<string[] | ErrorResponse>) {
  try {
    const { sheetId } = req.params;
    const { worksheetOptions } = await getWorksheetOptions(sheetId);
    res.status(200).send(worksheetOptions);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

export async function readFromSheet(
  req: Request,
  res: Response<
    | {
        rundown: OntimeRundown;
        customFields: CustomFields;
      }
    | ErrorResponse
  >,
) {
  try {
    const { sheetId } = req.params;
    const { options } = req.body;
    const data = await download(sheetId, options);
    res.status(200).send(data);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

export async function writeToSheet(req: Request, res: Response<void | ErrorResponse>) {
  try {
    const { sheetId } = req.params;
    const { options } = req.body;
    await upload(sheetId, options);
    res.status(200).send();
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

export async function openPublic(req: Request, res: Response<PublicSheetInfo | ErrorResponse>) {
  const reference = parseGoogleSheetInput(req.body.url);
  if (!reference) {
    res.status(422).send({ message: 'Paste a Google Sheets link or a sheet ID' });
    return;
  }

  try {
    const sheet = await openPublicSheet(reference.sheetId, reference.gid);
    res.status(200).send(sheet);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

export async function readFromPublicSheet(
  req: Request,
  res: Response<Awaited<ReturnType<typeof downloadPublic>> | ErrorResponse>,
) {
  try {
    const { sheetId } = req.params;
    const { options } = req.body;
    const data = await downloadPublic(sheetId, options);
    res.status(200).send(data);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

export async function listRecentSheets(_req: Request, res: Response<RecentSheet[] | ErrorResponse>) {
  try {
    const recentSheets = await getRecentSheets();
    res.status(200).send(recentSheets);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

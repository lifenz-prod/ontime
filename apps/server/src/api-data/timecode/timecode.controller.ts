import { ErrorResponse, TimecodeSettings, TimecodeSetup } from 'ontime-types';
import { getErrorMessage } from 'ontime-utils';

import type { Request, Response } from 'express';

import { failEmptyObjects } from '../../utils/routerUtils.js';
import { getDataProvider } from '../../classes/data-provider/DataProvider.js';
import { timecodeService } from '../../services/timecode-service/TimecodeService.js';
import { removeTimecodeSetup, upsertTimecodeSetup } from '../../services/timecode-service/timecodeSetups.js';
import {
  loadTimecodeSetups,
  saveTimecodeSetups,
} from '../../services/timecode-service/timecodeSetupsFile.js';

import { parseTimecodeTimers } from './timecode.parser.js';

export async function getTimecodeSettings(_req: Request, res: Response<TimecodeSettings>) {
  res.status(200).send(getDataProvider().getTimecode());
}

export async function postTimecodeSettings(req: Request, res: Response<TimecodeSettings | ErrorResponse>) {
  if (failEmptyObjects(req.body, res)) {
    return;
  }
  try {
    const newData: TimecodeSettings = {
      enabled: req.body.enabled,
      deviceLabel: req.body.deviceLabel,
      channel: req.body.channel,
      warningThreshold: req.body.warningThreshold,
      dangerThreshold: req.body.dangerThreshold,
      timeout: req.body.timeout,
      timers: parseTimecodeTimers(req.body.timers),
    };

    await getDataProvider().setTimecode(newData);
    timecodeService.updateSettings(newData);
    res.status(200).send(newData);
  } catch (error) {
    res.status(400).send({ message: getErrorMessage(error) });
  }
}

/** The timecode right now, to the frame, for "Set to current timecode" */
export async function getCurrentTimecode(
  _req: Request,
  res: Response<{ current: number | null; fps: number | null; signal: boolean }>,
) {
  res.status(200).send(timecodeService.getCurrent());
}

/** The saved timer setups, shared by every project */
export async function getTimecodeSetups(_req: Request, res: Response<TimecodeSetup[]>) {
  res.status(200).send(loadTimecodeSetups());
}

/** Saves timers under a name, replacing a setup of the same name */
export async function postTimecodeSetup(req: Request, res: Response<TimecodeSetup[] | ErrorResponse>) {
  try {
    const { setups } = upsertTimecodeSetup(loadTimecodeSetups(), req.body.name, req.body.timers);
    saveTimecodeSetups(setups);
    res.status(200).send(setups);
  } catch (error) {
    res.status(400).send({ message: getErrorMessage(error) });
  }
}

export async function deleteTimecodeSetup(req: Request, res: Response<TimecodeSetup[] | ErrorResponse>) {
  try {
    const setups = removeTimecodeSetup(loadTimecodeSetups(), req.params.id);
    saveTimecodeSetups(setups);
    res.status(200).send(setups);
  } catch (error) {
    res.status(400).send({ message: getErrorMessage(error) });
  }
}

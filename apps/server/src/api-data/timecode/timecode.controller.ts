import { ErrorResponse, TimecodeSettings } from 'ontime-types';
import { getErrorMessage } from 'ontime-utils';

import type { Request, Response } from 'express';

import { failEmptyObjects } from '../../utils/routerUtils.js';
import { getDataProvider } from '../../classes/data-provider/DataProvider.js';
import { timecodeService } from '../../services/timecode-service/TimecodeService.js';

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

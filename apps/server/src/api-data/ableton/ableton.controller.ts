import { AbletonClipPosition, AbletonSettings, ErrorResponse } from 'ontime-types';
import { getErrorMessage } from 'ontime-utils';

import type { Request, Response } from 'express';

import { failEmptyObjects } from '../../utils/routerUtils.js';
import { getDataProvider } from '../../classes/data-provider/DataProvider.js';
import { abletonService } from '../../services/ableton-service/AbletonService.js';

import { parseAbletonTimers } from './ableton.parser.js';

export async function getAbletonSettings(_req: Request, res: Response<AbletonSettings>) {
  const settings = getDataProvider().getAbleton();
  res.status(200).send(settings);
}

export async function postAbletonSettings(req: Request, res: Response<AbletonSettings | ErrorResponse>) {
  if (failEmptyObjects(req.body, res)) {
    return;
  }
  try {
    const newData: AbletonSettings = {
      enabled: req.body.enabled,
      host: String(req.body.host).trim(),
      port: req.body.port,
      listenPort: req.body.listenPort,
      warningThreshold: req.body.warningThreshold,
      dangerThreshold: req.body.dangerThreshold,
      timeout: req.body.timeout,
      timers: parseAbletonTimers(req.body.timers),
    };

    await getDataProvider().setAbleton(newData);
    abletonService.updateSettings(newData);
    res.status(200).send(newData);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

/** Reads where Live's playhead is in one clip, for "Set to current position" */
export async function postAbletonPosition(req: Request, res: Response<AbletonClipPosition | ErrorResponse>) {
  try {
    const position = await abletonService.readClipPosition(req.body.track, req.body.clip);
    res.status(200).send(position);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

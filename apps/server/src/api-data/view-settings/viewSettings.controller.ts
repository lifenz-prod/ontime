import type { ErrorResponse, ViewSettings } from 'ontime-types';
import { getErrorMessage } from 'ontime-utils';

import type { Request, Response } from 'express';

import { getDataProvider } from '../../classes/data-provider/DataProvider.js';
import { countdownService } from '../../services/countdown-service/CountdownService.js';

export async function getViewSettings(_req: Request, res: Response<ViewSettings>) {
  const views = getDataProvider().getViewSettings();
  res.status(200).send(views);
}

export async function postViewSettings(req: Request, res: Response<ViewSettings | ErrorResponse>) {
  try {
    // Anything posting view settings without this field means "leave it alone", not "use QLab".
    // The general panel's form does not know about it, so defaulting would silently switch the
    // countdown back to QLab behind the picker in the QLab and Mitti panels.
    const current = getDataProvider().getViewSettings();
    const countdownSource = req.body.countdownSource ?? current.countdownSource;

    const newData = {
      countdownSource: countdownSource === 'mitti' ? 'mitti' : 'qlab',
      dangerColor: req.body.dangerColor,
      endMessage: req.body.endMessage,
      freezeEnd: req.body.freezeEnd,
      normalColor: req.body.normalColor,
      overrideStyles: req.body.overrideStyles,
      warningColor: req.body.warningColor,
    } as ViewSettings;
    await getDataProvider().setViewSettings(newData);
    countdownService.setSource(newData.countdownSource);
    res.status(200).send(newData);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

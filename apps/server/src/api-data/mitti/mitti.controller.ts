import { ErrorResponse, MittiSettings } from 'ontime-types';
import { getErrorMessage } from 'ontime-utils';

import type { Request, Response } from 'express';

import { failEmptyObjects } from '../../utils/routerUtils.js';
import { getDataProvider } from '../../classes/data-provider/DataProvider.js';
import { mittiService } from '../../services/mitti-service/MittiService.js';

export async function getMittiSettings(_req: Request, res: Response<MittiSettings>) {
  const settings = getDataProvider().getMitti();
  res.status(200).send(settings);
}

export async function postMittiSettings(req: Request, res: Response<MittiSettings | ErrorResponse>) {
  if (failEmptyObjects(req.body, res)) {
    return;
  }
  try {
    const newData: MittiSettings = {
      enabled: req.body.enabled,
      host: req.body.host,
      port: req.body.port,
      listenPort: req.body.listenPort,
      warningThreshold: req.body.warningThreshold,
      dangerThreshold: req.body.dangerThreshold,
      timeout: req.body.timeout,
      relayHost: req.body.relayHost || null,
      relayPort: req.body.relayPort || null,
    };

    await getDataProvider().setMitti(newData);
    mittiService.updateSettings(newData);
    res.status(200).send(newData);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

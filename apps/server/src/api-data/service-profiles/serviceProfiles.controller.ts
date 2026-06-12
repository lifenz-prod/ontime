import type { Request, Response } from 'express';
import { ErrorResponse, MessageResponse, ServiceProfiles } from 'ontime-types';
import { getErrorMessage } from 'ontime-utils';

import { getDataProvider } from '../../classes/data-provider/DataProvider.js';
import { regenerateServiceInstances } from '../../services/rundown-service/RundownService.js';

export async function getServiceProfiles(_req: Request, res: Response<ServiceProfiles>) {
  const profiles = getDataProvider().getServiceProfiles();
  res.status(200).send(profiles as ServiceProfiles);
}

export async function postServiceProfiles(req: Request, res: Response<ServiceProfiles | ErrorResponse>) {
  try {
    const newData: ServiceProfiles = req.body;
    const saved = await getDataProvider().setServiceProfiles(newData);
    // changing the config invalidates the generated sections
    await regenerateServiceInstances();
    res.status(200).send(saved as ServiceProfiles);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

export async function postRegenerate(_req: Request, res: Response<MessageResponse | ErrorResponse>) {
  try {
    await regenerateServiceInstances();
    res.status(200).send({ message: 'Service instances regenerated' });
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

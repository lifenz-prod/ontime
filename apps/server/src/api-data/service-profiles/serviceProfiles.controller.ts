import type { Request, Response } from 'express';
import { ErrorResponse, ServiceProfiles } from 'ontime-types';
import { getErrorMessage } from 'ontime-utils';

import { getDataProvider } from '../../classes/data-provider/DataProvider.js';

export async function getServiceProfiles(_req: Request, res: Response<ServiceProfiles>) {
  const profiles = getDataProvider().getServiceProfiles();
  res.status(200).send(profiles as ServiceProfiles);
}

export async function postServiceProfiles(req: Request, res: Response<ServiceProfiles | ErrorResponse>) {
  try {
    const newData: ServiceProfiles = req.body;
    const saved = await getDataProvider().setServiceProfiles(newData);
    res.status(200).send(saved as ServiceProfiles);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

import type {
  ErrorResponse,
  PcoImportResult,
  PcoKnownItems,
  PcoPlanSheet,
  PcoPlanSummary,
  PcoRules,
  PcoServiceTypeSummary,
  PcoStatus,
} from 'ontime-types';
import { getErrorMessage } from 'ontime-utils';

import type { Request, Response } from 'express';

import { PcoError } from '../../services/pco-service/PcoClient.js';
import {
  getPcoConfig,
  getPcoKnownItems,
  getPcoPlanSheet,
  getPcoStatus,
  importPcoPlan,
  listPcoPlans,
  listPcoServiceTypes,
  removePcoCredentials,
  setPcoCredentials,
  setPcoRules,
} from '../../services/pco-service/PcoService.js';
import { mergePcoRules } from '../../services/pco-service/pcoRules.js';

/**
 * Planning Center calls fail for reasons the operator can act on -- a revoked
 * token, a service type that no longer exists, a plan with no service time -- so
 * the status PCO gave us is passed through rather than flattened to a 500.
 */
function sendFailure(res: Response<ErrorResponse>, error: unknown, fallbackStatus = 400) {
  const status = error instanceof PcoError && error.status ? error.status : fallbackStatus;
  res.status(status).send({ message: getErrorMessage(error) });
}

export async function getStatus(_req: Request, res: Response<PcoStatus | ErrorResponse>) {
  try {
    res.status(200).send(await getPcoStatus());
  } catch (error) {
    sendFailure(res, error);
  }
}

export async function getServiceTypes(_req: Request, res: Response<PcoServiceTypeSummary[] | ErrorResponse>) {
  try {
    res.status(200).send(await listPcoServiceTypes());
  } catch (error) {
    sendFailure(res, error);
  }
}

export async function getPlans(req: Request, res: Response<PcoPlanSummary[] | ErrorResponse>) {
  try {
    // a comma separated list, so one query can cover a campus
    const requested = typeof req.query.serviceTypeIds === 'string' ? req.query.serviceTypeIds : '';
    const serviceTypeIds = requested
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    const perServiceType = Number(req.query.perServiceType) || undefined;
    res.status(200).send(await listPcoPlans(serviceTypeIds, perServiceType));
  } catch (error) {
    sendFailure(res, error);
  }
}

export async function getKnownItems(req: Request, res: Response<PcoKnownItems | ErrorResponse>) {
  try {
    const serviceTypeId = typeof req.query.serviceTypeId === 'string' ? req.query.serviceTypeId : undefined;
    const plansToSample = Number(req.query.plans) || undefined;
    res.status(200).send(await getPcoKnownItems(serviceTypeId, plansToSample));
  } catch (error) {
    sendFailure(res, error);
  }
}

/** the run sheet of one plan, as the import page lists it */
export async function getPlanSheet(req: Request, res: Response<PcoPlanSheet | ErrorResponse>) {
  try {
    const serviceTypeId = typeof req.query.serviceTypeId === 'string' ? req.query.serviceTypeId : '';
    const planId = typeof req.query.planId === 'string' ? req.query.planId : '';
    if (!serviceTypeId || !planId) {
      return res.status(400).send({ message: 'serviceTypeId and planId are both required' });
    }
    // the plan is cached while a row is being worked through, so a refresh is how
    // somebody who has just edited it in Planning Center goes back and re-reads
    const refresh = req.query.refresh === 'true';
    res.status(200).send(await getPcoPlanSheet(serviceTypeId, planId, refresh));
  } catch (error) {
    sendFailure(res, error);
  }
}

export async function getRules(_req: Request, res: Response<PcoRules>) {
  res.status(200).send(getPcoConfig().rules);
}

export async function postRules(req: Request, res: Response<PcoRules | ErrorResponse>) {
  try {
    // merged over the defaults, so a key the panel does not know about cannot be
    // dropped by a round trip and an unknown one cannot be written
    res.status(200).send(setPcoRules(mergePcoRules(req.body)));
  } catch (error) {
    sendFailure(res, error);
  }
}

export async function postImport(req: Request, res: Response<PcoImportResult | ErrorResponse>) {
  try {
    const result = await importPcoPlan({
      serviceTypeId: req.body.serviceTypeId,
      planId: req.body.planId,
      targetDate: req.body.targetDate || undefined,
    });
    res.status(200).send(result);
  } catch (error) {
    // a refusal to interrupt a running show is a conflict, not a bad request
    const running = getErrorMessage(error).startsWith('Refusing to import');
    sendFailure(res, error, running ? 409 : 400);
  }
}

/**
 * Saves a token pair after checking it against Planning Center.
 *
 * Nothing about the pair comes back: the response is the new status, which reports
 * presence and a masked application id. The secret only ever travels inwards.
 */
export async function postCredentials(req: Request, res: Response<PcoStatus | ErrorResponse>) {
  try {
    await setPcoCredentials({ applicationId: req.body.applicationId, secret: req.body.secret });
    res.status(200).send(await getPcoStatus());
  } catch (error) {
    sendFailure(res, error);
  }
}

export async function deleteCredentials(_req: Request, res: Response<PcoStatus | ErrorResponse>) {
  try {
    removePcoCredentials();
    res.status(200).send(await getPcoStatus());
  } catch (error) {
    sendFailure(res, error);
  }
}

import { body, validationResult } from 'express-validator';
import type { Request, Response, NextFunction } from 'express';

function report(req: Request, res: Response, next: NextFunction) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
  next();
}

/**
 * The shape the panel sends back.
 *
 * Only the scalars are checked here. The nested rules and effects are sanitised by
 * `mergePcoRules`, which drops keys it does not know and falls back to the shipped
 * default for anything missing -- a better guarantee than a validator chain that
 * has to be kept in step with the type by hand.
 */
export const validatePcoRules = [
  body('enabled').isBoolean(),
  body('timezone').isString().notEmpty(),
  body('serviceTypeId').optional({ nullable: true }).isString(),
  body('serviceTypeName').optional({ nullable: true }).isString(),
  body('pinnedServiceTypes').isArray(),
  body('pinnedServiceTypes.*.id').isString().notEmpty(),
  body('pinnedServiceTypes.*.name').isString(),
  body('pinnedServiceTypes.*.group').optional({ nullable: true }).isString(),
  body('preBoundaryTitleMatch').isString(),
  body('preAnchor').isIn(['plan-time', 'back-from-service']),
  body('serviceNames').isArray(),
  body('headersAsBlocks').isBoolean(),
  body('titleStrip').isString(),
  body('respectMasterExclusions').isBoolean(),
  body('ignoreItems').isArray(),
  body('timerRules').isArray(),
  body('timerRules.*.name').isString().notEmpty(),
  body('inferredEntries').isArray(),

  report,
];

export const validatePcoImport = [
  body('serviceTypeId').isString().notEmpty(),
  body('planId').isString().notEmpty(),
  body('targetDate')
    .optional({ nullable: true })
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('targetDate must be YYYY-MM-DD'),

  report,
];

export const validatePcoCredentials = [
  body('applicationId').isString().trim().notEmpty(),
  body('secret').isString().trim().notEmpty(),

  report,
];

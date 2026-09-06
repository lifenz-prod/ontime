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
  body('headersBecome').isIn(['block', 'event', 'nothing']),
  // a list of patterns, or the single one it used to be
  body('titleStrip').custom((value) => {
    if (typeof value === 'string') {
      return true;
    }
    if (Array.isArray(value) && value.every((pattern) => typeof pattern === 'string')) {
      return true;
    }
    throw new Error('titleStrip must be a pattern or a list of patterns');
  }),
  body('normaliseTitleCase').isBoolean(),
  body('titleWords')
    .optional()
    .custom((value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('titleWords must be an object of word -> spelling');
      }
      if (!Object.values(value).every((spelling) => typeof spelling === 'string')) {
        throw new Error('every titleWords spelling must be a string');
      }
      return true;
    }),
  body('respectMasterExclusions').isBoolean(),
  body('fixedDurationCarriesForward').isBoolean(),
  body('collapseSections').isArray(),
  body('collapseSections.*.name').isString().notEmpty(),
  body('mergeIntoPrevious').isArray(),
  body('ignoreItems').isArray(),
  body('timerRules').isArray(),
  body('timerRules.*.name').isString().notEmpty(),
  // a map of service type id -> rules, written by the import page
  body('serviceTypeRules')
    .optional()
    .custom((value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('serviceTypeRules must be an object keyed by service type id');
      }
      for (const rules of Object.values(value)) {
        if (!Array.isArray(rules)) {
          throw new Error('each serviceTypeRules entry must be an array of rules');
        }
      }
      return true;
    }),
  body('inferredEntries').isArray(),
  body('inferredEntries.*.title').isString().notEmpty(),
  body('inferredEntries.*.duration').isInt({ min: 0 }),
  body('deriveRehearsalTimes').isBoolean(),
  body('deriveTimedHeaders').isBoolean(),
  /**
   * Null is meaningful here -- it is how the panel says the morning opens on its
   * first rehearsal time -- so this is one check rather than a nullable object
   * followed by field chains that would not run on the null.
   */
  body('leadIn').custom((value) => {
    if (value === null || value === undefined) {
      return true;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('leadIn must be an object or null');
    }
    if (typeof value.title !== 'string' || !value.title.trim()) {
      throw new Error('leadIn.title must be a non-empty string');
    }
    if (!Number.isInteger(value.duration) || value.duration < 0) {
      throw new Error('leadIn.duration must be a positive number of milliseconds');
    }
    return true;
  }),

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

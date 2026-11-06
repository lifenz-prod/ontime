import { body, validationResult } from 'express-validator';
import type { Request, Response, NextFunction } from 'express';

function handleErrors(req: Request, res: Response, next: NextFunction) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
  next();
}

export const validateAbletonSettings = [
  body('enabled').isBoolean(),
  body('host').isString().trim().notEmpty(),
  body('port').isInt({ min: 1, max: 65535 }),
  body('listenPort').isInt({ min: 1, max: 65535 }),
  body('warningThreshold').isInt({ min: 0 }),
  body('dangerThreshold').isInt({ min: 0 }),
  body('timeout').isInt({ min: 1000 }),
  body('timers').optional().isArray(),
  body('timers.*.name').optional().isString(),
  body('timers.*.track').isInt({ min: 1 }).toInt(),
  body('timers.*.clip').isInt({ min: 1 }).toInt(),
  body('timers.*.target').isInt({ min: 1 }).toInt(),
  handleErrors,
];

export const validateAbletonPositionRequest = [
  body('track').isInt({ min: 1 }).toInt(),
  body('clip').isInt({ min: 1 }).toInt(),
  handleErrors,
];

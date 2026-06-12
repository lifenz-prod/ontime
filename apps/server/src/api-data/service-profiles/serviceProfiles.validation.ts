import { body, validationResult } from 'express-validator';
import type { Request, Response, NextFunction } from 'express';

export const validateServiceProfiles = [
  body('boundaryBlockId').custom((value) => value === null || (typeof value === 'string' && value.length > 0)),
  body('services').isArray(),
  body('services.*.id').isString().notEmpty(),
  body('services.*.name').isString().notEmpty(),
  body('services.*.offset').isInt({ min: 0, max: 86399999 }),

  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
    next();
  },
];

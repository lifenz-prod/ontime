import { body, validationResult } from 'express-validator';
import type { Request, Response, NextFunction } from 'express';

export const validateServiceProfiles = [
  body().isArray(),
  body('*.id').isString().notEmpty(),
  body('*.name').isString().notEmpty(),
  body('*.startTime').isInt({ min: 0, max: 86399999 }),

  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
    next();
  },
];

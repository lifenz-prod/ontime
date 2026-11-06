import { body, validationResult } from 'express-validator';
import type { Request, Response, NextFunction } from 'express';

export const validateTimecodeSettings = [
  body('enabled').isBoolean(),
  body('deviceLabel').isString(),
  body('channel').isInt({ min: 1, max: 64 }),
  body('warningThreshold').isInt({ min: 0 }),
  body('dangerThreshold').isInt({ min: 0 }),
  body('timeout').isInt({ min: 100, max: 10000 }),
  body('timers').optional().isArray(),
  body('timers.*.name').optional().isString(),
  body('timers.*.from').isInt({ min: 0 }).toInt(),
  body('timers.*.zero').isInt({ min: 0 }).toInt(),
  body('timers').custom((timers) => {
    if (!Array.isArray(timers)) return true;
    if (timers.some((timer) => Number(timer?.zero) <= Number(timer?.from))) {
      throw new Error('Each timer must reach zero after it starts');
    }
    return true;
  }),
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
    next();
  },
];

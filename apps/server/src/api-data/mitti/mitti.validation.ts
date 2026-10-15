import { body, validationResult } from 'express-validator';
import type { Request, Response, NextFunction } from 'express';

/** the relay pointing back at this machine is the one case we can detect and refuse */
function isThisMachine(host: unknown): boolean {
  return typeof host === 'string' && ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(host.trim());
}

export const validateMittiSettings = [
  body('enabled').isBoolean(),
  body('host').isString().notEmpty(),
  body('port').isInt({ min: 1, max: 65535 }),
  body('listenPort').isInt({ min: 1, max: 65535 }),
  body('warningThreshold').isInt({ min: 0 }),
  body('dangerThreshold').isInt({ min: 0 }),
  body('timeout').isInt({ min: 1000 }),
  body('relayHost').optional({ nullable: true, checkFalsy: true }).isString(),
  body('relayPort').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1, max: 65535 }),
  // relaying to our own listen port would feed Mitti's packets straight back into us
  body('relayPort').custom((relayPort, { req }) => {
    if (!relayPort || !req.body.relayHost) return true;
    if (Number(relayPort) === Number(req.body.listenPort) && isThisMachine(req.body.relayHost)) {
      throw new Error('Relay port must differ from the listen port when relaying to this machine');
    }
    return true;
  }),

  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
    next();
  },
];

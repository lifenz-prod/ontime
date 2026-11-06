import express from 'express';

import { getAbletonSettings, postAbletonPosition, postAbletonSettings } from './ableton.controller.js';
import { validateAbletonPositionRequest, validateAbletonSettings } from './ableton.validation.js';

export const router = express.Router();

router.get('/', getAbletonSettings);
router.post('/', validateAbletonSettings, postAbletonSettings);
router.post('/position', validateAbletonPositionRequest, postAbletonPosition);

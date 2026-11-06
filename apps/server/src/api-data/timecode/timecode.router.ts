import express from 'express';

import { getCurrentTimecode, getTimecodeSettings, postTimecodeSettings } from './timecode.controller.js';
import { validateTimecodeSettings } from './timecode.validation.js';

export const router = express.Router();

router.get('/', getTimecodeSettings);
router.post('/', validateTimecodeSettings, postTimecodeSettings);
router.get('/current', getCurrentTimecode);

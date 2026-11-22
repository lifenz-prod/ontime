import express from 'express';

import {
  deleteTimecodeSetup,
  getCurrentTimecode,
  getTimecodeSettings,
  getTimecodeSetups,
  postTimecodeSettings,
  postTimecodeSetup,
} from './timecode.controller.js';
import { validateTimecodeSettings, validateTimecodeSetup, validateTimecodeSetupId } from './timecode.validation.js';

export const router = express.Router();

router.get('/', getTimecodeSettings);
router.post('/', validateTimecodeSettings, postTimecodeSettings);
router.get('/current', getCurrentTimecode);
router.get('/setups', getTimecodeSetups);
router.post('/setups', validateTimecodeSetup, postTimecodeSetup);
router.delete('/setups/:id', validateTimecodeSetupId, deleteTimecodeSetup);

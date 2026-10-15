import express from 'express';
import { getMittiSettings, postMittiSettings } from './mitti.controller.js';
import { validateMittiSettings } from './mitti.validation.js';

export const router = express.Router();

router.get('/', getMittiSettings);
router.post('/', validateMittiSettings, postMittiSettings);

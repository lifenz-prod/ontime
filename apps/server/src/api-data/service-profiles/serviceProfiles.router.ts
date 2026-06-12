import express from 'express';

import { getServiceProfiles, postServiceProfiles } from './serviceProfiles.controller.js';
import { validateServiceProfiles } from './serviceProfiles.validation.js';

export const router = express.Router();

router.get('/', getServiceProfiles);
router.post('/', validateServiceProfiles, postServiceProfiles);

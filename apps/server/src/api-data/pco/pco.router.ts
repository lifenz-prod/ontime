import express from 'express';

import {
  getKnownItems,
  getPlans,
  getRules,
  getServiceTypes,
  getStatus,
  postImport,
  postRules,
} from './pco.controller.js';
import { validatePcoImport, validatePcoRules } from './pco.validation.js';

export const router = express.Router();

router.get('/', getStatus);
router.get('/service-types', getServiceTypes);
router.get('/plans', getPlans);
router.get('/known-items', getKnownItems);
router.get('/rules', getRules);
router.post('/rules', validatePcoRules, postRules);
router.post('/import', validatePcoImport, postImport);

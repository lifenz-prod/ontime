import express from 'express';

import {
  deleteCredentials,
  getKnownItems,
  getPlans,
  getRules,
  getServiceTypes,
  getStatus,
  postCredentials,
  postImport,
  postRules,
} from './pco.controller.js';
import { validatePcoCredentials, validatePcoImport, validatePcoRules } from './pco.validation.js';

export const router = express.Router();

router.get('/', getStatus);
router.get('/service-types', getServiceTypes);
router.get('/plans', getPlans);
router.get('/known-items', getKnownItems);
router.get('/rules', getRules);
router.post('/rules', validatePcoRules, postRules);
router.post('/import', validatePcoImport, postImport);
router.post('/credentials', validatePcoCredentials, postCredentials);
router.delete('/credentials', deleteCredentials);

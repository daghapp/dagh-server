import express from 'express'
import { apiLimiter, authenticate, authorizeAdmin } from '../middleware/auth'
import { validate } from '../middleware/validate'
import {
  createVisaApplicationSchema,
  documentUploadSchema,
  passportScanSchema,
  applicationIdSchema,
  updateStatusSchema,
  getAllApplicationsSchema
} from '../validator/visaValidation'
import {
  createVisaApplication,
  getUserApplications,
  getApplicationById,
  uploadDocument,
  scanPassport,
  getAllApplications,
  updateVisaStatus
} from '../controllers/visaController'

const router = express.Router()

// Apply rate limiting to all routes
router.use(apiLimiter)

// User routes with validation
router.post(
  '/request', 
  authenticate,
  validate(createVisaApplicationSchema),
  createVisaApplication
)

router.get(
  '/my', 
  authenticate,
  getUserApplications
)

router.get(
  '/:id', 
  authenticate,
  validate(applicationIdSchema),
  getApplicationById
)

router.post(
  '/:id/upload-itinerary', 
  authenticate,
  validate(documentUploadSchema),
  uploadDocument
)

router.post(
  '/passport-scan', 
  authenticate,
  validate(passportScanSchema),
  scanPassport
)

// Admin routes with validation
router.get(
  '/', 
  authenticate, 
  authorizeAdmin,
  validate(getAllApplicationsSchema),
  getAllApplications
)

router.patch(
  '/:id/approve', 
  authenticate, 
  authorizeAdmin,
  validate(updateStatusSchema),
  (req, res) => updateVisaStatus(req, res)
)

router.patch(
  '/:id/reject', 
  authenticate, 
  authorizeAdmin,
  validate(applicationIdSchema),
  (req, res) => updateVisaStatus(req, res)
)

export default router

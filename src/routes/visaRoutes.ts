// routes/visaRoutes.ts
import express from 'express'
import { authenticate, authorizeAdmin } from '../middleware/auth'
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

// Public routes (with authentication)
router.post('/request', authenticate, createVisaApplication)
router.get('/my', authenticate, getUserApplications)
router.get('/:id', authenticate, getApplicationById)
router.post('/:id/upload-itinerary', authenticate, uploadDocument)
router.post('/passport-scan', authenticate, scanPassport)

// Admin routes
router.get('/', authenticate, authorizeAdmin, getAllApplications)
router.patch('/:id/approve', authenticate, authorizeAdmin, (req, res) => 
  updateVisaStatus(req, res)
)
router.patch('/:id/reject', authenticate, authorizeAdmin, (req, res) => 
  updateVisaStatus(req, res)
)

export default router
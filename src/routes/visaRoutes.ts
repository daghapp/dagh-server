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

/**
 * @swagger
 * /visa/request:
 *   post:
 *     summary: Create a new visa application
 *     tags: [Visa Applications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VisaApplicationRequest'
 *     responses:
 *       201:
 *         description: Visa application created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/VisaApplication'
 *       500:
 *         description: Failed to create visa application
 */
router.post('/request', authenticate, createVisaApplication)

/**
 * @swagger
 * /visa/my:
 *   get:
 *     summary: Get all visa applications for the authenticated user
 *     tags: [Visa Applications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user's visa applications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/VisaApplication'
 *       500:
 *         description: Failed to fetch applications
 */
router.get('/my', authenticate, getUserApplications)

/**
 * @swagger
 * /visa/{id}:
 *   get:
 *     summary: Get a specific visa application by ID
 *     tags: [Visa Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Visa application ID
 *     responses:
 *       200:
 *         description: Visa application details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/VisaApplication'
 *       404:
 *         description: Application not found
 *       500:
 *         description: Failed to fetch application
 */
router.get('/:id', authenticate, getApplicationById)

/**
 * @swagger
 * /visa/{id}/upload-itinerary:
 *   post:
 *     summary: Upload a document for a visa application
 *     tags: [Visa Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Visa application ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DocumentUploadRequest'
 *     responses:
 *       200:
 *         description: Document uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     type:
 *                       type: string
 *                     fileUrl:
 *                       type: string
 *       404:
 *         description: Application not found
 *       500:
 *         description: Failed to upload document
 */
router.post('/:id/upload-itinerary', authenticate, uploadDocument)

/**
 * @swagger
 * /visa/passport-scan:
 *   post:
 *     summary: Scan and store passport details
 *     tags: [Visa Applications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PassportScanRequest'
 *     responses:
 *       200:
 *         description: Passport scanned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       500:
 *         description: Failed to scan passport
 */
router.post('/passport-scan', authenticate, scanPassport)

/**
 * @swagger
 * /visa:
 *   get:
 *     summary: Get all visa applications (Admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, REVIEW, APPROVED, REJECTED]
 *         description: Filter by status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *     responses:
 *       200:
 *         description: List of all visa applications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/VisaApplication'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     pages:
 *                       type: integer
 *       403:
 *         description: Access denied
 *       500:
 *         description: Failed to fetch applications
 */
router.get('/', authenticate, authorizeAdmin, getAllApplications)

/**
 * @swagger
 * /visa/{id}/approve:
 *   patch:
 *     summary: Approve a visa application (Admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Visa application ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               visaNumber:
 *                 type: string
 *                 description: Visa number (required for approval)
 *     responses:
 *       200:
 *         description: Application approved successfully
 *       403:
 *         description: Access denied
 *       404:
 *         description: Application not found
 *       500:
 *         description: Failed to approve application
 */
router.patch('/:id/approve', authenticate, authorizeAdmin, (req, res) => 
  updateVisaStatus(req, res)
)

/**
 * @swagger
 * /visa/{id}/reject:
 *   patch:
 *     summary: Reject a visa application (Admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Visa application ID
 *     responses:
 *       200:
 *         description: Application rejected successfully
 *       403:
 *         description: Access denied
 *       404:
 *         description: Application not found
 *       500:
 *         description: Failed to reject application
 */
router.patch('/:id/reject', authenticate, authorizeAdmin, (req, res) => 
  updateVisaStatus(req, res)
)

export default router
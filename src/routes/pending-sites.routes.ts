import express from "express";
import protectedRoute from "../middleware/protected.js";
import { requireRole } from "../middleware/permissions.js";
import { validate } from "../middleware/validation.js";
import { submitPendingSiteSchema } from "../validator/pending-site-validator.js";
import { PendingSiteController } from "../modules/pending-sites/pending-site.controller.js";

// ─────────────────────────────────────────
// USER-GENERATED TOUR SITES (§3) — submission + admin approval workflow.
// All paths are RELATIVE: this router is mounted at /pending-sites, so the
// final endpoints are /pending-sites, /pending-sites/mine, /pending-sites/admin…
// ─────────────────────────────────────────

const router = express.Router();
const pendingSite = new PendingSiteController();

/**
 * @swagger
 * /pending-sites:
 *   post:
 *     summary: Submit a new tour site for admin review
 *     description: Stages a user-generated tour site in the pending queue. Admins later approve (migrating it to the live catalogue) or reject it. Duplicate names (case-insensitive, against live sites and other pending submissions) are rejected.
 *     tags: [Pending Sites]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, region, latitude, longitude]
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 100
 *                 example: Wli Waterfalls
 *               region:
 *                 type: string
 *                 enum: [Greater Accra, Central, Western, Western North, Volta, Oti, Eastern, Ashanti, Bono, Bono East, Ahafo, Savannah, Northern, North East, Upper East, Upper West]
 *                 example: Volta
 *               latitude:
 *                 type: number
 *                 minimum: 4.5
 *                 maximum: 11.5
 *                 example: 7.0131
 *               longitude:
 *                 type: number
 *                 minimum: -3.3
 *                 maximum: 1.3
 *                 example: 0.5126
 *               description:
 *                 type: string
 *                 minLength: 10
 *                 maxLength: 2000
 *                 example: The highest waterfall in West Africa, set in the Agumatsa Range.
 *               category:
 *                 type: string
 *                 maxLength: 50
 *                 example: Nature / Waterfall
 *               imageUrl:
 *                 type: string
 *                 format: uri
 *                 example: https://example.com/wli.jpg
 *     responses:
 *       201:
 *         description: Site submitted for admin review
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Tour site submitted pending admin review
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                     region: { type: string }
 *                     latitude: { type: number }
 *                     longitude: { type: number }
 *                     description: { type: string, nullable: true }
 *                     category: { type: string }
 *                     imageUrl: { type: string, nullable: true }
 *                     status: { type: string, example: pending }
 *                     submittedBy: { type: string, format: uuid }
 *                     createdAt: { type: string, format: date-time }
 *       400:
 *         description: Validation failure (missing/invalid fields)
 *       401:
 *         description: Unauthenticated
 *       409:
 *         description: A site with this name already exists (live or pending)
 *       500:
 *         description: Failed to submit tour site
 */
router.post("/", protectedRoute, validate(submitPendingSiteSchema), pendingSite.submitSite);

/**
 * @swagger
 * /pending-sites/mine:
 *   get:
 *     summary: List the authenticated user's own submissions
 *     description: Returns every pending-site submission the user has made, newest first, with moderation status and any rejection reason.
 *     tags: [Pending Sites]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Submission history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       name: { type: string }
 *                       region: { type: string }
 *                       category: { type: string }
 *                       status: { type: string, enum: [pending, approved, rejected] }
 *                       rejectReason: { type: string, nullable: true }
 *                       imageUrl: { type: string, nullable: true }
 *                       createdAt: { type: string, format: date-time }
 *       401:
 *         description: Unauthenticated
 *       500:
 *         description: Failed to fetch submissions
 */
router.get("/mine", protectedRoute, pendingSite.mySubmissions);

/**
 * @swagger
 * /pending-sites/admin:
 *   get:
 *     summary: List pending sites for moderation (admin only)
 *     description: Paginated moderation queue ordered by newest first. Omit `status` to see every row regardless of state.
 *     tags: [Pending Sites]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *         description: Filter by moderation status (omit for all)
 *         example: pending
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
 *           default: 20
 *           maximum: 100
 *         description: Results per page
 *     responses:
 *       200:
 *         description: Moderation queue retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     sites:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           name: { type: string }
 *                           region: { type: string }
 *                           latitude: { type: number }
 *                           longitude: { type: number }
 *                           description: { type: string, nullable: true }
 *                           category: { type: string }
 *                           imageUrl: { type: string, nullable: true }
 *                           status: { type: string, enum: [pending, approved, rejected] }
 *                           submittedBy: { type: string, format: uuid }
 *                           rejectReason: { type: string, nullable: true }
 *                           createdAt: { type: string, format: date-time }
 *                           updatedAt: { type: string, format: date-time }
 *                     total: { type: integer }
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *       400:
 *         description: Invalid status filter
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Admin role required
 *       500:
 *         description: Failed to list pending sites
 */
router.get("/admin", protectedRoute, requireRole(["ADMIN"]), pendingSite.listPendingSites);

/**
 * @swagger
 * /pending-sites/admin/{siteId}/approve:
 *   post:
 *     summary: Approve a pending site (admin only)
 *     description: Migrates the pending row into the production tour_sites catalogue — normalizing the free-text category into the SiteCategory enum, preserving the user's wording as an album tag, and deriving the transit profile from the region. The submitter is notified by email (best-effort).
 *     tags: [Pending Sites]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: siteId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Pending site id
 *     responses:
 *       200:
 *         description: Site approved and migrated to production
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Site approved and migrated to production
 *                 data:
 *                   type: object
 *                   properties:
 *                     siteId: { type: string, format: uuid }
 *                     tourSiteId: { type: string, format: uuid }
 *       400:
 *         description: Site is not in pending status
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Admin role required
 *       404:
 *         description: Pending site not found
 *       409:
 *         description: A live site with this name already exists (name conflict)
 *       500:
 *         description: Failed to approve tour site
 */
router.post(
  "/admin/:siteId/approve",
  protectedRoute,
  requireRole(["ADMIN"]),
  pendingSite.approveSite,
);

/**
 * @swagger
 * /pending-sites/admin/{siteId}/reject:
 *   post:
 *     summary: Reject a pending site (admin only)
 *     description: Marks the submission rejected with a revision reason that is emailed to the submitter (best-effort) so they know what to fix before resubmitting.
 *     tags: [Pending Sites]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: siteId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Pending site id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rejectReason]
 *             properties:
 *               rejectReason:
 *                 type: string
 *                 minLength: 5
 *                 example: Coordinates do not match the described location — please verify and resubmit.
 *     responses:
 *       200:
 *         description: Site rejected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Site rejected
 *                 data:
 *                   type: object
 *                   properties:
 *                     siteId: { type: string, format: uuid }
 *                     rejectReason: { type: string }
 *       400:
 *         description: Missing/short rejectReason, or site is not pending
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Admin role required
 *       404:
 *         description: Pending site not found
 *       500:
 *         description: Failed to reject tour site
 */
router.post(
  "/admin/:siteId/reject",
  protectedRoute,
  requireRole(["ADMIN"]),
  pendingSite.rejectSite,
);

export { router };

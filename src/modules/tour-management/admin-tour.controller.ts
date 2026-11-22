//get all tours
//get tours user has booked
//book a tour by user
//cancel a tour booking by user
//update tour by admin
//delete tour by admin
//create tour by admin
//create tour itinerary by admin
//update tour itinerary by admin
//delete tour itinerary by admin
//delete tour itinerary by admin
//tour media management by admin
// user has paid for a tour
//assign tour guide to a tour by admin
//unassign tour guide from a tour by admin

//add tour review by user
//get tour reviews by tour id
//get tour reviews by user id
//delete tour review by user

import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../../config/index.js";
import { TourSchema, UpdateTourSchema, TourItinerarySchema } from "../../validator/index.js";
import { ok, created, fail, paginated } from "../../helpers/response.js";
import { logAdminActivity, AdminEntityType } from "../../helpers/admin-activity.js";

const isPrismaNotFoundError = (error: unknown): error is { code: string } => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
};

const ensureAdmin = (req: Request, res: Response) => {
  const accountType = req.user?.accountType;

  if (!accountType || accountType.toUpperCase() !== "ADMIN") {
    return fail(res, 403, "Forbidden: Admins only");
  }

  return null;
};

export class AdminTourController {
  // Create a new tour (Save Draft skips publish validation; Publish validates)
  async createTour(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const tourData = req.body as TourSchema & { gallery?: string[] };
      const publishError = validatePublishable(tourData);
      if (publishError) return fail(res, 400, publishError);

      const {
        gallery,
        itineraries: _itineraries,
        locations: _locations,
        media: _media,
        ...scalar
      } = tourData as TourSchema & {
        gallery?: string[];
        itineraries?: unknown;
        locations?: unknown;
        media?: unknown;
      };
      const newTour = await prisma.tour_packages.create({
        data: {
          ...(scalar as object),
          slug: await uniqueSlug(tourData.slug, tourData.title),
          lastModifiedBy: req.user?.id ?? null,
          ...(gallery && gallery.length > 0
            ? {
                tour_media: {
                  create: gallery.map((url) => ({ id: randomUUID(), media_type: "image", url })),
                },
              }
            : {}),
        },
        include: { tour_media: true },
      });
      await logAdminActivity({
        actorId: req.user!.id,
        entityType: AdminEntityType.TOUR_DESTINATION,
        entityId: newTour.id,
        action: "DESTINATION_CREATED",
        note: newTour.title ?? undefined,
      });
      return created(res, withPublicUrl(newTour), "Tour created successfully");
    } catch (error) {
      console.error("Error creating tour:", error);
      return fail(res, 500, "Failed to create tour");
    }
  }

  // Update an existing tour
  async updateTour(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const tourId = req.params.id as string;
      const tourData = req.body as UpdateTourSchema & { gallery?: string[] };
      const existing = await prisma.tour_packages.findUnique({ where: { id: tourId } });
      if (!existing) return fail(res, 404, "Tour not found");

      const nextStatus = (tourData.status as string | undefined) ?? existing.status ?? "draft";
      const publishError = validatePublishable({ ...existing, ...tourData, status: nextStatus });
      if (publishError) return fail(res, 400, publishError);

      const {
        gallery,
        itineraries: _itineraries,
        locations: _locations,
        media: _media,
        ...scalar
      } = tourData as UpdateTourSchema & {
        gallery?: string[];
        itineraries?: unknown;
        locations?: unknown;
        media?: unknown;
      };
      const updatedTour = await prisma.$transaction(async (tx) => {
        if (gallery !== undefined) {
          await tx.tour_media.deleteMany({ where: { tour_id: tourId } });
        }
        return tx.tour_packages.update({
          where: { id: tourId },
          data: {
            ...(scalar as object),
            lastModifiedBy: req.user?.id ?? null,
            ...(gallery !== undefined
              ? {
                  tour_media: {
                    create: (gallery as string[]).map((url) => ({
                      id: randomUUID(),
                      media_type: "image",
                      url,
                    })),
                  },
                }
              : {}),
          },
          include: { tour_media: true, tour_locations: true },
        });
      });
      await logAdminActivity({
        actorId: req.user!.id,
        entityType: AdminEntityType.TOUR_DESTINATION,
        entityId: tourId,
        action: "DESTINATION_UPDATED",
        metadata: { keys: Object.keys(scalar) },
      });
      return ok(res, withPublicUrl(updatedTour), "Tour updated successfully");
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return fail(res, 404, "Tour not found");
      }
      console.error("Error updating tour:", error);
      return fail(res, 500, "Failed to update tour");
    }
  }

  // Archive a tour instead of hard delete (§3.5) — keeps bookings/history intact.
  async deleteTour(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const tourId = req.params.id as string;
      const existing = await prisma.tour_packages.findUnique({ where: { id: tourId } });
      if (!existing) return fail(res, 404, "Tour not found");

      const archived = await prisma.tour_packages.update({
        where: { id: tourId },
        data: { status: "archived", lastModifiedBy: req.user?.id ?? null },
      });
      await logAdminActivity({
        actorId: req.user!.id,
        entityType: AdminEntityType.TOUR_DESTINATION,
        entityId: tourId,
        action: "DESTINATION_ARCHIVED",
        note: existing.title ?? undefined,
        metadata: { previous: existing.status, new: "archived" },
      });
      return ok(res, withPublicUrl(archived), "Tour archived successfully");
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return fail(res, 404, "Tour not found");
      }
      console.error("Error archiving tour:", error);
      return fail(res, 500, "Failed to archive tour");
    }
  }

  //add tour itinerary by admin
  async addTourItinerary(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const tourId = req.params.id as string;
      const itineraryData = req.body as TourItinerarySchema;
      const { activities, ...itineraryFields } = itineraryData;

      // Check if the tour exists before adding itinerary
      const tour = await prisma.tour_packages.findUnique({
        where: { id: tourId },
      });
      if (!tour) {
        return fail(res, 404, "Tour not found");
      }
      const newItinerary = await prisma.tour_itineraries.create({
        data: {
          ...itineraryFields,
          tourId,
          itinerary_activities: activities?.length
            ? {
                create: activities.map((activity) => ({
                  id: randomUUID(),
                  activityTime: activity.activityTime,
                  activity: activity.activity,
                  durationMinutes: activity.durationMinutes,
                  included: activity.included,
                  cost: activity.cost,
                  locationName: activity.locationName,
                  locationAddress: activity.locationAddress,
                })),
              }
            : undefined,
        },
        include: { itinerary_activities: true },
      });
      return created(res, newItinerary, "Tour itinerary added successfully");
    } catch (error) {
      console.error("Error adding tour itinerary:", error);
      return fail(res, 500, "Failed to add tour itinerary");
    }
  }

  //update tour itinerary by admin
  async updateTourItinerary(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const itineraryId = req.params.id as string;
      const itineraryData = req.body as TourItinerarySchema;
      const { activities, ...itineraryFields } = itineraryData;

      const updatedItinerary = await prisma.$transaction(async (tx) => {
        const updated = await tx.tour_itineraries.update({
          where: { id: itineraryId },
          data: itineraryFields,
        });

        if (activities !== undefined) {
          await tx.itinerary_activities.deleteMany({
            where: { itineraryId },
          });

          if (activities.length > 0) {
            await tx.itinerary_activities.createMany({
              data: activities.map((activity) => ({
                id: randomUUID(),
                itineraryId,
                activityTime: activity.activityTime,
                activity: activity.activity,
                durationMinutes: activity.durationMinutes,
                included: activity.included,
                cost: activity.cost,
                locationName: activity.locationName,
                locationAddress: activity.locationAddress,
              })),
            });
          }
        }

        const itineraryWithActivities = await tx.tour_itineraries.findUnique({
          where: { id: itineraryId },
          include: { itinerary_activities: true },
        });

        return itineraryWithActivities ?? updated;
      });

      return ok(res, updatedItinerary, "Tour itinerary updated successfully");
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return fail(res, 404, "Itinerary not found");
      }
      console.error("Error updating tour itinerary:", error);
      return fail(res, 500, "Failed to update tour itinerary");
    }
  }

  // ── Destination catalogue (§3.5) ──────────────────────────────

  // GET /admin/tours — all statuses, filters, search, pagination + stats.
  async listDestinations(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) return unauthorizedResponse;

      const { status, category, search, from, to } = req.query;
      const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
      const where: Record<string, unknown> = {};
      if (typeof status === "string") where.status = normalizeStatus(status);
      if (typeof category === "string") where.category = category;
      if (typeof from === "string" || typeof to === "string") {
        const createdAt: Record<string, Date> = {};
        if (typeof from === "string" && !Number.isNaN(Date.parse(from)))
          createdAt.gte = new Date(from);
        if (typeof to === "string" && !Number.isNaN(Date.parse(to))) createdAt.lte = new Date(to);
        if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;
      }
      if (typeof search === "string" && search.length > 0) {
        where.OR = [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { region: { contains: search, mode: "insensitive" } },
        ];
      }
      const [rows, total, byStatus] = await Promise.all([
        prisma.tour_packages.findMany({
          where,
          include: { tour_media: true, tour_locations: true },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.tour_packages.count({ where }),
        prisma.tour_packages.groupBy({ by: ["status"], _count: { status: true } }),
      ]);
      return paginated(res, rows.map(withPublicUrl), total, page, limit, undefined, {
        stats: {
          total,
          byStatus: Object.fromEntries(
            byStatus.map((s) => [s.status ?? "unknown", s._count.status]),
          ),
        },
      });
    } catch (error) {
      console.error("Error listing destinations:", error);
      return fail(res, 500, "Failed to list destinations");
    }
  }

  // GET /admin/tours/:id — includes drafts, gallery, last-modified info.
  async getDestination(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) return unauthorizedResponse;

      const tour = await prisma.tour_packages.findUnique({
        where: { id: req.params.id as string },
        include: { tour_media: true, tour_locations: true, tour_itineraries: true },
      });
      if (!tour) return fail(res, 404, "Destination not found");
      return ok(res, { ...withPublicUrl(tour), lastModifiedAt: tour.updatedAt });
    } catch (error) {
      console.error("Error fetching destination:", error);
      return fail(res, 500, "Failed to fetch destination");
    }
  }

  // PATCH /admin/tours/:id/status — status dropdown + visibility toggle.
  async updateStatus(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) return unauthorizedResponse;

      const status = normalizeStatus(req.body?.status);
      if (!status) {
        return fail(
          res,
          400,
          "status must be one of DRAFT | ACTIVE | ARCHIVED (or draft | published | archived)",
        );
      }
      const tourId = req.params.id as string;
      const existing = await prisma.tour_packages.findUnique({ where: { id: tourId } });
      if (!existing) return fail(res, 404, "Destination not found");

      if (status === "published") {
        const publishError = validatePublishable({ ...existing, status });
        if (publishError) return fail(res, 400, publishError);
      }
      const updated = await prisma.tour_packages.update({
        where: { id: tourId },
        data: {
          status,
          lastModifiedBy: req.user?.id ?? null,
          ...(status === "published" && !existing.publishedAt ? { publishedAt: new Date() } : {}),
        },
        include: { tour_media: true },
      });
      await logAdminActivity({
        actorId: req.user!.id,
        entityType: AdminEntityType.TOUR_DESTINATION,
        entityId: tourId,
        action: "DESTINATION_STATUS_CHANGED",
        metadata: { previous: existing.status, new: status },
      });
      return ok(res, withPublicUrl(updated), "Status updated");
    } catch (error) {
      console.error("Error updating destination status:", error);
      return fail(res, 500, "Failed to update status");
    }
  }

  // DELETE /admin/tours/:id/media/:mediaId — remove a gallery image.
  async deleteMedia(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) return unauthorizedResponse;

      const media = await prisma.tour_media.findUnique({
        where: { id: req.params.mediaId as string },
      });
      if (!media || media.tour_id !== (req.params.id as string)) {
        return fail(res, 404, "Media not found for this destination");
      }
      await prisma.tour_media.delete({ where: { id: media.id } });
      await prisma.tour_packages.update({
        where: { id: req.params.id as string },
        data: { lastModifiedBy: req.user?.id ?? null },
      });
      await logAdminActivity({
        actorId: req.user!.id,
        entityType: AdminEntityType.TOUR_DESTINATION,
        entityId: req.params.id as string,
        action: "DESTINATION_MEDIA_REMOVED",
        metadata: { mediaId: media.id },
      });
      return ok(res, null as never, "Media removed");
    } catch (error) {
      console.error("Error removing destination media:", error);
      return fail(res, 500, "Failed to remove media");
    }
  }

  //delete tour itinerary by admin
  async deleteTourItinerary(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const itineraryId = req.params.id as string;
      await prisma.tour_itineraries.delete({
        where: { id: itineraryId },
      });
      return ok(res, null as never, "Tour itinerary deleted successfully");
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return fail(res, 404, "Itinerary not found");
      }
      console.error("Error deleting tour itinerary:", error);
      return fail(res, 500, "Failed to delete tour itinerary");
    }
  }
}

// ── Destination helpers (§3.5) ──────────────────────────────────────────

const STATUS_ALIASES: Record<string, string> = {
  DRAFT: "draft",
  ACTIVE: "published",
  ARCHIVED: "archived",
  PENDING_REVIEW: "pending_review",
};

function normalizeStatus(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = STATUS_ALIASES[raw] ?? raw;
  return ["draft", "published", "archived", "pending_review"].includes(normalized)
    ? normalized
    : null;
}

/** Publish validation: drafts skip it, ACTIVE/published requires the basics. */
function validatePublishable(
  tour: { status?: unknown; title?: unknown; description?: unknown; coverImage?: unknown } & Record<
    string,
    unknown
  >,
): string | null {
  const status =
    typeof tour.status === "string" ? (STATUS_ALIASES[tour.status] ?? tour.status) : "draft";
  if (status !== "published") return null;
  if (!tour.title) return "Title is required to publish a destination";
  if (!tour.description) return "Description is required to publish a destination";
  const gallery = tour.gallery as unknown;
  const hasMedia = !!tour.coverImage || (Array.isArray(gallery) && gallery.length > 0);
  if (!hasMedia) return "A cover image or gallery image is required to publish a destination";
  return null;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function uniqueSlug(
  provided: string | undefined,
  title: string | undefined,
): Promise<string | undefined> {
  if (provided) return provided;
  if (!title) return undefined;
  const base = slugify(title) || "destination";
  return `${base}-${randomUUID().slice(0, 6)}`;
}

/** Stable public URL for "Preview on Portal" (GET /tours/:tourId today). */
function withPublicUrl<T extends { id: string; slug?: string | null }>(
  tour: T,
): T & { publicUrl: string } {
  return { ...tour, publicUrl: `/tours/${tour.slug ?? tour.id}` };
}

import { prisma } from "../../config/index.js";
import {
  ListingStatus as LS,
  ListingType as LT,
  BadgeType as BT,
} from "../../../generated/prisma/client.js";
import { logAdminActivity, AdminEntityType } from "../../helpers/admin-activity.js";

export async function createListing(ownerId: string, data: any) {
  return prisma.propertyListing.create({
    data: {
      ownerId,
      type: (data.type as LT) ?? LT.SALE,
      title: data.title,
      description: data.description,
      priceGhs: data.priceGhs,
      currency: data.currency ?? "GHS",
      region: data.region,
      district: data.district ?? null,
      address: data.address ?? null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      images: data.images ?? [],
      documents: data.documents ?? [],
      status: LS.DRAFT,
    },
  });
}

export async function submitForVerification(id: string, ownerId: string) {
  const row = await prisma.propertyListing.findUnique({ where: { id } });
  if (!row || row.ownerId !== ownerId) throw new Error("Not found");
  return prisma.propertyListing.update({
    where: { id },
    data: { status: LS.PENDING_VERIFICATION },
  });
}

export async function listListings(
  filters: { region?: string; type?: string; status?: string },
  limit = 20,
  offset = 0,
) {
  const where: any = {};
  if (filters.region) where.region = filters.region;
  if (filters.type) where.type = filters.type as LT;
  if (filters.status) where.status = filters.status as LS;
  else where.status = LS.VERIFIED;
  const [rows, total] = await Promise.all([
    prisma.propertyListing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { owner: { select: { id: true, fullName: true } } },
    }),
    prisma.propertyListing.count({ where }),
  ]);
  return { rows, total };
}

export async function getListing(id: string) {
  return prisma.propertyListing.findUnique({
    where: { id },
    include: { owner: { select: { id: true, fullName: true } } },
  });
}

export async function adminQueue(status = "PENDING_VERIFICATION", limit = 50, offset = 0) {
  const where = { status: status as LS };
  const [rows, total] = await Promise.all([
    prisma.propertyListing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { owner: { select: { id: true, fullName: true } } },
    }),
    prisma.propertyListing.count({ where }),
  ]);
  return { rows, total };
}

export async function requestVerification(id: string, requesterId: string) {
  const row = await prisma.propertyListing.findUnique({ where: { id } });
  if (!row) throw new Error("Not found");
  if (row.ownerId !== requesterId) throw new Error("Not your listing");
  if (row.status === LS.VERIFIED) return row;

  const updated = await prisma.propertyListing.update({
    where: { id },
    data: { status: LS.PENDING_VERIFICATION },
  });
  await prisma.listingSearchRequest.create({
    data: {
      requesterId,
      listingId: id,
      query: `Verification requested for ${row.title}`,
      searchType: "VERIFICATION",
      status: "PENDING",
    },
  });
  return updated;
}

export async function adminDecide(id: string, adminId: string, approve: boolean, reason?: string) {
  const updated = await prisma.propertyListing.update({
    where: { id },
    data: {
      status: approve ? LS.VERIFIED : LS.REJECTED,
      verifiedAt: approve ? new Date() : null,
      verifiedBy: approve ? adminId : null,
    },
  });
  await logAdminActivity({
    actorId: adminId,
    entityType: AdminEntityType.LISTING,
    entityId: id,
    action: approve ? "APPROVED" : "REJECTED",
    note: reason,
  });
  return updated;
}

export async function issueBadge(id: string, adminId: string, badge: string) {
  const issuedAt = new Date();
  const updated = await prisma.propertyListing.update({
    where: { id },
    data: {
      badge: badge as BT,
      badgeIssuedAt: issuedAt,
      verifiedBy: adminId,
      verifiedAt: issuedAt,
      status: LS.VERIFIED,
    },
  });
  await logAdminActivity({
    actorId: adminId,
    entityType: AdminEntityType.LISTING,
    entityId: id,
    action: "BADGE_ISSUED",
    note: badge,
    metadata: { badge, badgeIssuedAt: issuedAt.toISOString() },
  });
  return updated;
}

export async function createSearchRequest(
  requesterId: string,
  data: { listingId?: string; query: string; searchType: string },
) {
  return prisma.listingSearchRequest.create({
    data: {
      requesterId,
      listingId: data.listingId ?? null,
      query: data.query,
      searchType: data.searchType,
      status: "PENDING",
    },
  });
}

export async function listSearchRequests(limit = 50, offset = 0) {
  const [rows, total] = await Promise.all([
    prisma.listingSearchRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.listingSearchRequest.count(),
  ]);
  return { rows, total };
}

export async function updateSearchRequest(id: string, status: string, resultRef?: string) {
  return prisma.listingSearchRequest.update({
    where: { id },
    data: { status, resultRef: resultRef ?? null },
  });
}

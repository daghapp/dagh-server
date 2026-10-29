import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import {
  getDatingSelectionsForTours,
  getItineraryByRequestId,
  loadItineraryCatalogues,
} from "./itinerary.service.js";
import { ok, fail } from "../../helpers/response.js";
import { isPaymentsEnabled } from "../../config/payments.js";

// Building one itinerary costs several queries, so fanning out over every tour
// request at once can exhaust the pg pool (and its 5s connect timeout). A small
// worker pool keeps DB pressure bounded without serialising the whole request.
const MY_ITINERARIES_CONCURRENCY = Math.max(1, Number(process.env.MY_ITINERARIES_CONCURRENCY) || 3);

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

export async function getUserItineraries(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;

    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    // When payments are off every tour request is effectively paid — the
    // individual fetch (getItineraryByRequestId) auto-waives STATUS in that
    // case, so filtering to SUCCESS here would return an empty list for
    // requests that haven't been fetched individually yet.
    const paymentsOff = !(await isPaymentsEnabled());
    const paidRequests = await prisma.tourRequest.findMany({
      where: {
        userId,
        ...(paymentsOff ? {} : { paymentStatus: "SUCCESS" }),
      },
      select: {
        id: true,
        paymentStatus: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!paidRequests.length) {
      return ok(res, [], "Itineraries retrieved successfully.");
    }

    // Load shared supply once for the whole request instead of once per
    // itinerary, and batch dating selections into a single query.
    const [catalogues, datingSelectionsByRequest] = await Promise.all([
      loadItineraryCatalogues(),
      getDatingSelectionsForTours(paidRequests.map((r) => r.id)),
    ]);

    const itineraries = await mapWithConcurrency(paidRequests, MY_ITINERARIES_CONCURRENCY, (r) =>
      // getItineraryByRequestId handles: request-not-found, payment gating,
      // existing itinerary retrieval OR lazy generation.
      getItineraryByRequestId(r.id, userId, {
        catalogues,
        datingSelections: datingSelectionsByRequest.get(r.id) ?? [],
      }),
    );

    return ok(res, itineraries, "Itineraries retrieved successfully.");
  } catch (error) {
    console.error("[getUserItineraries]", error);
    return fail(res, 500, "Failed to retrieve itineraries.");
  }
}

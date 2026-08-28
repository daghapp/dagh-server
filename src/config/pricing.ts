/**
 * Environment-driven pricing configuration (Phase 2.4).
 *
 * Replaces hardcoded amounts (464, 1450 GHS, 200 USD) that were scattered
 * across check-pending-payments.ts, user-visa.controller.ts, and itinerary.payment.controller.ts.
 * Values can be overridden via environment variables for different deployments.
 */
export const pricing = {
  visa: {
    standardFacilitationFee: parseFloat(process.env.VISA_STANDARD_FEE_GHS || "464"),
    expeditedFacilitationFee: parseFloat(process.env.VISA_EXPEDITED_FEE_GHS || "1450"),
    statutoryFeeUSD: parseFloat(process.env.VISA_STATUTORY_FEE_USD || "200"),
  },
  itinerary: {
    shortItineraryFee: parseFloat(process.env.ITINERARY_SHORT_FEE_GHS || "350"),
    longItineraryFee: parseFloat(process.env.ITINERARY_LONG_FEE_GHS || "500"),
  },
} as const;

export type Pricing = typeof pricing;

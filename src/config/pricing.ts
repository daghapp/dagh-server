export const pricing = {
  visa: {
    standardFacilitationFee: parseFloat(process.env.VISA_STANDARD_FEE_GHS || "464"),
    expeditedFacilitationFee: parseFloat(process.env.VISA_EXPEDITED_FEE_GHS || "1450"),
    statutoryFeeUSD: parseFloat(process.env.VISA_STATUTORY_FEE_USD || "200"),
  },
} as const;

export type Pricing = typeof pricing;

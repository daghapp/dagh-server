export const generateSlug = (text: string) => {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-')      // Replace spaces with -
    .replace(/--+/g, '-')      // Replace multiple - with single -
    .trim();
};

export const generateBookingNumber = () => {
  return `BK-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
};

export const generateReference = (prefix = 'REF') => {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};


export function mapMomoProvider(method: "MTN_MOMO" | "TELECEL_MOMO" | "AT_MOMO"): string {
  switch (method) {
    case "MTN_MOMO":
      return "mtn-gh";
    case "TELECEL_MOMO":
      return "vodafone-gh"; // Telecel Ghana is Vodafone in Hubtel
    case "AT_MOMO":
      return "tigo-gh";     // AirtelTigo Ghana
    default:
      throw new Error(`Unsupported MoMo provider: ${method}`);
  }
}

// utils/currency.ts
export async function convertUSDToGHS(amountUSD: number): Promise<number> {
  // Hard‑coded conversion rate for now
  const conversionRate = 12.5; // Example: 1 USD = 12.5 GHS

  return amountUSD * conversionRate;
}
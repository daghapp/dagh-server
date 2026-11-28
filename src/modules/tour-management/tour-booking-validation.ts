export function validateTourBooking(input: {
  numberOfPeople: number;
  tourStartDate: Date;
  basePrice: number;
  minimumBooking: number | null;
}): string | null {
  if (
    !Number.isSafeInteger(input.numberOfPeople) ||
    input.numberOfPeople < Math.max(1, input.minimumBooking ?? 1)
  ) {
    return "Invalid number of travellers";
  }
  if (!Number.isFinite(input.tourStartDate.getTime())) return "Invalid departure date";
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (input.tourStartDate.getTime() < today) return "Departure date cannot be in the past";
  if (
    !Number.isFinite(input.basePrice) ||
    input.basePrice < 0 ||
    !Number.isFinite(input.basePrice * input.numberOfPeople)
  ) {
    return "Invalid tour price";
  }
  return null;
}

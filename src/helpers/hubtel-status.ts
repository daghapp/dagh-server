type StoredPayment = { reference: string; amount: number; currency: string };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function verifiedHubtelStatus(
  payload: unknown,
  payment: StoredPayment,
): "SUCCESS" | "PENDING" | null {
  const result = record(payload);
  const data = record(result.data);
  if (result.responseCode !== "0000" || data.clientReference !== payment.reference) return null;
  if (payment.currency !== "GHS") return null;
  if (data.currencyCode != null && data.currencyCode !== payment.currency) return null;
  if (data.status === "Unpaid") return "PENDING";
  if (data.status !== "Paid") return null;
  if (
    typeof data.amount !== "number" ||
    !Number.isFinite(data.amount) ||
    !Number.isFinite(payment.amount) ||
    payment.amount <= 0 ||
    Math.abs(data.amount - payment.amount) > 0.000001
  ) {
    return null;
  }
  return "SUCCESS";
}

import { PaymentStatus } from "../../generated/prisma/client.js";

export function paymentStatusFromHubtel(responseCode: string): PaymentStatus {
  switch (responseCode) {
    case "0000":
      return PaymentStatus.SUCCESS;
    case "2001":
      return PaymentStatus.FAILED;
    case "0001":
    default:
      return PaymentStatus.PENDING;
  }
}

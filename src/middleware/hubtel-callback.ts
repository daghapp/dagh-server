import { Request, Response, NextFunction } from "express";
import { getHubtelStatusClient } from "../config/hubtel.js";
import { prisma } from "../config/prisma.js";
import { fail, ok } from "../helpers/response.js";
import { verifiedHubtelStatus } from "../helpers/hubtel-status.js";

/** Treat callbacks as notifications; independently verify the stored collection. */
export default async function verifyHubtelCallback(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { ResponseCode, Data } = req.body ?? {};
    if (
      typeof ResponseCode !== "string" ||
      typeof Data?.ClientReference !== "string" ||
      !Data.ClientReference
    ) {
      return fail(res, 400, "Invalid callback payload");
    }
    const payment = await prisma.payment.findUnique({
      where: { reference: Data.ClientReference },
    });
    if (!payment || payment.provider !== "HUBTEL") {
      return fail(res, 404, "Payment not found");
    }
    if (["SUCCESS", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.status)) {
      return ok(res, null, "Payment already processed");
    }
    const client = await getHubtelStatusClient();
    const response = await client.get("", { params: { clientReference: payment.reference } });
    const status = verifiedHubtelStatus(response.data, payment);
    if (status === null) return fail(res, 502, "Unable to verify transaction");
    if (status !== "SUCCESS") return fail(res, 409, "Payment not yet confirmed");
    // Downstream legacy handlers consume PascalCase fields. Derive the success
    // indicator and financial fields from the independently verified response.
    const verified = response.data.data;
    req.body = {
      ResponseCode: "0000",
      Status: "SUCCESS",
      Message: "Payment verified",
      Data: {
        ClientReference: payment.reference,
        Amount: verified.amount,
        Charges: verified.charges ?? 0,
        AmountAfterCharges: verified.amountAfterCharges ?? verified.amount,
        AmountCharged: verified.amount,
        TransactionId: verified.transactionId,
        ExternalTransactionId: verified.externalTransactionId,
        SalesInvoiceId: verified.transactionId,
        Description: "Payment verified",
        responseCode: "0000",
        DeliveryFee: 0,
      },
    };
    next();
  } catch (error) {
    console.error("Hubtel callback verification error:", error);
    return fail(res, 502, "Unable to verify transaction with Hubtel");
  }
}

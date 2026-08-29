import { Request, Response, NextFunction } from "express";
import { hubtelStatusClient } from "../config/hubtel.js";
import { fail, ok } from "../helpers/response.js";

/**
 * Middleware to verify Hubtel payment callbacks.
 * Validates payload structure and verifies the transaction status with Hubtel's API
 * before allowing the callback to be processed.
 */
export default async function verifyHubtelCallback(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { ResponseCode, Data } = req.body;

    if (!ResponseCode || !Data) {
      return fail(res, 400, "Invalid callback payload");
    }

    if (!Data.ClientReference || !Data.TransactionId) {
      return fail(res, 400, "Missing transaction identifiers");
    }

    // Verify the transaction with Hubtel's Transaction Status API
    try {
      const statusResponse = await hubtelStatusClient.get(`/${Data.TransactionId}`);
      const statusData = statusResponse.data;

      // If Hubtel reports the transaction as failed, reject the callback
      if (statusData.Status === "FAILED") {
        return ok(res, null, "Transaction confirmed as failed by Hubtel");
      }
    } catch (e) {
      // If the status check fails, reject the callback — Hubtel will retry
      console.log("hb ", e);
      console.error("Failed to verify transaction status with Hubtel API, rejecting callback");
      return fail(res, 502, "Unable to verify transaction with Hubtel");
    }

    next();
  } catch (error) {
    console.error("Hubtel callback verification error:", error);
    return fail(res, 500, "Callback verification failed");
  }
}

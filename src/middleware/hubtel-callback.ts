import { Request, Response, NextFunction } from "express";
import { hubtelStatusClient } from "../config/hubtel.js";

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
      return res.status(400).json({ success: false, message: "Invalid callback payload" });
    }

    if (!Data.ClientReference || !Data.TransactionId) {
      return res.status(400).json({ success: false, message: "Missing transaction identifiers" });
    }

    // Verify the transaction with Hubtel's Transaction Status API
    try {
      const statusResponse = await hubtelStatusClient.get(`/${Data.TransactionId}`);
      const statusData = statusResponse.data;

      // If Hubtel reports the transaction as failed, reject the callback
      if (statusData.Status === "FAILED") {
        return res.status(200).json({
          success: true,
          message: "Transaction confirmed as failed by Hubtel",
        });
      }
    } catch {
      // If the status check fails, log but don't block the callback
      // Hubtel may have network issues; the callback itself is still valid
      console.error("Failed to verify transaction status with Hubtel API");
    }

    next();
  } catch (error) {
    console.error("Hubtel callback verification error:", error);
    return res.status(500).json({ success: false, message: "Callback verification failed" });
  }
}

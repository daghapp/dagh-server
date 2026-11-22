import axios from "axios";

export interface SmsPayload {
  to: string;
  message: string;
}

export async function sendSms({ to, message }: SmsPayload): Promise<void> {
  const clientId = process.env.HUBTEL_CLIENT_ID || process.env.HUBTEL_CLIENTID;
  const clientSecret = process.env.HUBTEL_CLIENT_SECRET || process.env.HUBTEL_CLIENTSECRET;
  const sender = process.env.HUBTEL_SMS_SENDER || process.env.SMS_SENDER || "DiasporaSync";

  if (!clientId || !clientSecret) {
    // No SMS provider configured — cannot actually deliver. Throw so the
    // controller can fall back to email instead of falsely reporting success.
    throw new Error(
      "SMS provider not configured (HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET missing)",
    );
  }

  const url = "https://smsc.hubtel.com/v1/messages/send";
  try {
    await axios.get(url, {
      params: {
        clientid: clientId,
        clientsecret: clientSecret,
        from: sender,
        to,
        content: message,
      },
      timeout: 15000,
    });
  } catch (err) {
    const e = err as {
      response?: { status?: number; data?: unknown };
      request?: unknown;
      message?: string;
    };
    if (e.response) {
      // Hubtel returned a non-2xx response — log the body for diagnosis.
      console.error("[HUBTEL_ERROR]", {
        status: e.response?.status,
        data: e.response?.data,
        to,
        sender,
      });
    } else if (e.request) {
      console.error("[HUBTEL_NO_RESPONSE]", { to, sender, message: e.message });
    } else {
      console.error("[HUBTEL_REQUEST_ERROR]", { to, sender, message: e.message });
    }
    throw err;
  }
}

export const sendSMS = sendSms;
export default sendSms;

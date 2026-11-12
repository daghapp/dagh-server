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
    // Dev fallback: no SMS provider configured.
    console.log(`[SMS-DEV] to=${to} message=${message}`);
    return;
  }

  const url = "https://smsc.hubtel.com/v1/messages/send";
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
}

export const sendSMS = sendSms;
export default sendSms;

import axios from "axios";

const requiredEnvVars = ['HUBTEL_CLIENT_ID', 'HUBTEL_CLIENT_SECRET', 'HUBTEL_MERCHANT_NUMBER', 'HUBTEL_BASE_URL'] as const;
const missing = requiredEnvVars.filter(key => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required Hubtel env vars: ${missing.join(', ')}`);
}

const hubtelClient = axios.create({
  baseURL: process.env.HUBTEL_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(
      `${process.env.HUBTEL_CLIENT_ID}:${process.env.HUBTEL_CLIENT_SECRET}`
    ).toString("base64")}`,
  },
  timeout: 15000,
});

// Separate client for transaction status API
const hubtelStatusClient = axios.create({
  baseURL: "https://api-txnstatus.hubtel.com/transactions/"+process.env.HUBTEL_MERCHANT_NUMBER+"/status",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(
      `${process.env.HUBTEL_CLIENT_ID}:${process.env.HUBTEL_CLIENT_SECRET}`
    ).toString("base64")}`,
  },
  timeout: 15000,
});

const hubtelDirectMoneyReceive = axios.create({
baseURL: "https://rmp.hubtel.com/merchantaccount/merchants/"+process.env.HUBTEL_MERCHANT_NUMBER+"/receive/mobilemoney",
headers: {
  "Content-Type": "application/json",
  Authorization: `Basic ${Buffer.from(
    `${process.env.HUBTEL_CLIENT_ID}:${process.env.HUBTEL_CLIENT_SECRET}`
  ).toString("base64")}`,
},
timeout: 15000,
})

export { hubtelClient, hubtelStatusClient, hubtelDirectMoneyReceive };
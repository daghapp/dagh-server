import axios from "axios";

// Log credentials for debugging (remove in production)
// console.log("Hubtel Config:", {
//   baseURL: process.env.HUBTEL_BASE_URL,
//   clientId: process.env.HUBTEL_CLIENT_ID,
//   hasSecret: !!process.env.HUBTEL_CLIENT_SECRET,
//   secretLength: process.env.HUBTEL_CLIENT_SECRET?.length,
// });

// Validate required env vars
if (!process.env.HUBTEL_CLIENT_ID || !process.env.HUBTEL_CLIENT_SECRET || !process.env.HUBTEL_MERCHANT_NUMBER ) {
  console.error("❌ Missing Hubtel credentials in environment variables!");
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
  baseURL: "https://api-txnstatus.hubtel.com",
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
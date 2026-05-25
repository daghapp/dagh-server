import {z} from "zod";


export const initializePaymentSchema_momo= z.object({
  userId: z.string().uuid("Invalid user ID"),
  targetType: z.enum(["VISA_ON_ARRIVAL", "TOUR_BOOKING"]),
  targetId: z.string().uuid("Invalid target ID"),
  amount: z.number().positive("Amount must be greater than 0"),
  currency: z.string().default("GHS"),
  method: z.enum(["MTN_MOMO", "TELECEL_MOMO", "AT_MOMO"]),
  provider: z.enum(["HUBTEL", "PAYSTACK", "STRIPE", "FLUTTERWAVE"]),
  callbackUrl: z.string().url("Invalid callback URL"),
  description: z.string().optional(),
  customerPhone: z.string().regex(/^233\d{9}$/, "Phone must be a valid Ghana MSISDN"),
});


export const initializePaymentSchema_card = z.object({
  userId: z.string().uuid("Invalid user ID"),
  targetType: z.enum(["VISA_ON_ARRIVAL", "TOUR_BOOKING"]),
  targetId: z.string().uuid("Invalid target ID"),
  amount: z.number().positive("Amount must be greater than 0"),
  currency: z.string().default("GHS"),
  method: z.literal("CARD"), // must be card
  provider: z.enum(["HUBTEL", "PAYSTACK", "STRIPE", "FLUTTERWAVE"]),
//   callbackUrl: z.string().url("Invalid callback URL"),
  description: z.string().optional(),

  // Card-specific fields
  cardNumber: z.string().regex(/^\d{13,19}$/, "Card number must be 13–19 digits"),
  expiryMonth: z.string().regex(/^(0[1-9]|1[0-2])$/, "Invalid expiry month"),
  expiryYear: z.string().regex(/^\d{4}$/, "Invalid expiry year"),
  cvv: z.string().regex(/^\d{3,4}$/, "CVV must be 3–4 digits"),
  cardHolderName: z.string().min(2, "Card holder name required"),
});



export const hubtelDirectReceiveResponseSchema = z.object({
  Message: z.string(),          // e.g. "Transaction pending..."
  ResponseCode: z.string(),     // e.g. "0001"
  Data: z.object({
    TransactionId: z.string(),       // Hubtel transaction ID
    Description: z.string(),         // description from request payload
    ClientReference: z.string(),     // merchant reference
    Amount: z.number().positive(),   // transaction amount
    Charges: z.number().nonnegative(),
    AmountAfterCharges: z.number().nonnegative(),
    AmountCharged: z.number().positive(),
    DeliveryFee: z.number().nonnegative(),
  }),
});


export const subscribtionPaymentSchema = z.object({
    invoiceNumber: z.string().min(1, { message: "Invoice number is required" }),
    customerName: z.string().min(1, { message: "Customer name is required" }),
    customerPhoneNumber: z.string().min(1, { message: "Customer phone number is required" }),
    customerEmail: z.string().email({ message: "Customer email must be a valid email address" }),
    hasTax: z.boolean(),
    issuedBy: z.string().min(1, { message: "Issued by is required" }),
    createdBy: z.string().min(1, { message: "Created by is required" }),
    dueDate: z.string().datetime({ message: "Due date must be a valid ISO 8601 datetime" }),
    isDefault: z.boolean(),
    callbackUrl: z.string().url({ message: "Callback URL must be a valid URL" }),
    note: z.string().optional(),
    reminders: z.array(
        z.object({
            days: z.number().positive({ message: "Days must be a positive number" }),
            isBefore: z.boolean()
        })
    ).optional(),
    items: z.array(
        z.object({
            description: z.string().min(1, { message: "Item description is required" }),
            quantity: z.number().positive({ message: "Quantity must be a positive number" }),
            unitPrice: z.number().nonnegative({ message: "Unit price must be a non-negative number" })
        })
    ).min(1, { message: "At least one item is required" })
})

export type InitializePaymentSchema_MOMO = z.infer<typeof initializePaymentSchema_momo>;
export type InitializePaymentSchema_CARD = z.infer<typeof initializePaymentSchema_card>;
export type SubscribtionPaymentSchema = z.infer<typeof subscribtionPaymentSchema>;
export type HubtelDirectReceiveResponseSchema = z.infer<typeof hubtelDirectReceiveResponseSchema>;
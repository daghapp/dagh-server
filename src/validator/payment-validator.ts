import {z} from "zod";

export const initializePaymentSchema = z.object({
    totalAmount: z.number().positive({ message: "Total amount must be a positive number" }),
    description : z.string().min(1, { message: "Description is required" }),
    returnUrl: z.string().url({ message: "Return URL must be a valid URL" }),
    callbackUrl: z.string().url({ message: "Callback URL must be a valid URL" }),
    cancellationUrl: z.string().url({ message: "Cancellation URL must be a valid URL" }),
})

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

export type InitializePaymentSchema = z.infer<typeof initializePaymentSchema>;
export type SubscribtionPaymentSchema = z.infer<typeof subscribtionPaymentSchema>;
import { z } from "zod";

export const registerDeviceSchema = z.object({
  deviceId: z.string().min(1, "Device ID is required"),
  platform: z.enum(["IOS", "ANDROID"]),
  expoPushToken: z.string().nullable().optional(),
  fcmToken: z.string().nullable().optional(),
  apnsToken: z.string().nullable().optional(),
  voipPushToken: z.string().nullable().optional(),
});

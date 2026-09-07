import { z } from "zod";

export const registerDeviceSchema = z.object({
  deviceId: z.string().min(1, "Device ID is required"),
  platform: z.enum(["IOS", "ANDROID"]),
  // Token independence: a field omitted from the request preserves the stored
  // token for this installation; an explicit null clears it.
  expoPushToken: z.string().nullable().optional(),
  fcmToken: z.string().nullable().optional(),
  apnsToken: z.string().nullable().optional(),
  voipPushToken: z.string().nullable().optional(),
});

import { z } from "zod";

export const sendMessageSchema = z
  .object({
    receiverId: z.string().uuid("Invalid receiver ID"),
    content: z.string().min(1, "Message cannot be empty").max(2000, "Message too long").optional(),
    type: z.enum(["TEXT", "VOICE_NOTE", "IMAGE", "VIDEO", "CALL_LOG"]).optional().default("TEXT"),
    mediaUrl: z.string().url("Invalid media URL").optional(),
    mediaDuration: z.number().int().nonnegative().optional(),
    // End-to-end encryption fields (client-encrypted payload).
    ciphertext: z.string().min(1).optional(),
    nonce: z.string().min(1).optional(),
    aad: z.string().optional(),
    encryptionVersion: z.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    const encrypted = data.encryptionVersion !== undefined;
    if (encrypted) {
      if (!data.ciphertext) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "ciphertext is required for encrypted messages",
          path: ["ciphertext"],
        });
      }
      if (!data.nonce) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "nonce is required for encrypted messages",
          path: ["nonce"],
        });
      }
      return;
    }
    if (data.type === "TEXT" && !data.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Content is required for TEXT messages",
        path: ["content"],
      });
    }
    if ((data.type === "IMAGE" || data.type === "VIDEO") && !data.mediaUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mediaUrl is required for IMAGE and VIDEO messages",
        path: ["mediaUrl"],
      });
    }
  });

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const sendVoiceNoteSchema = z.object({
  receiverId: z.string().uuid("Invalid receiver ID"),
  mediaDuration: z.coerce.number().int().nonnegative("Duration must be a positive integer"),
});

export type SendVoiceNoteInput = z.infer<typeof sendVoiceNoteSchema>;

export const blockUserSchema = z.object({
  blockedId: z.string().uuid("Invalid user ID to block"),
});

export type BlockUserInput = z.infer<typeof blockUserSchema>;

export const reportUserSchema = z.object({
  targetId: z.string().uuid("Invalid user ID to report"),
  reason: z.string().min(3, "Reason is required").max(255),
  details: z.string().max(1000).optional(),
});

export type ReportUserInput = z.infer<typeof reportUserSchema>;

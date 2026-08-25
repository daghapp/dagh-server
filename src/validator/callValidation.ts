import { z } from "zod";

export const initiateCallSchema = z.object({
  receiverId: z.string().uuid("Invalid receiver ID"),
  conversationId: z.string().uuid("Invalid conversation ID").nullable().optional(),
  callType: z.enum(["VOICE", "VIDEO"]).default("VOICE"),
});

export const callIdParamSchema = z.object({
  callId: z.string().uuid("Invalid call ID"),
});

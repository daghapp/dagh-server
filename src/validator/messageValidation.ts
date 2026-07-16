import { z } from "zod";

export const sendMessageSchema = z.object({
  receiverId: z.uuid("Invalid receiver ID"),
  content: z.string().min(1, "Message cannot be empty").max(2000, "Message too long"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

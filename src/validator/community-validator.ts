import { z } from "zod";

export const syncCommunityVideosSchema = z.object({
  channelId: z.string().min(1, "channelId must not be empty").optional(),
  handle: z.string().min(1, "handle must not be empty").optional(),
  maxResults: z.number().int().min(1).max(20).optional(),
});

export type SyncCommunityVideosSchema = z.infer<typeof syncCommunityVideosSchema>;

import { z } from "zod";

export const updateDataPolicySchema = z.object({
  content: z.string().min(1, "Policy content must not be empty"),
  title: z.string().min(1, "Title must not be empty").optional(),
});

export type UpdateDataPolicySchema = z.infer<typeof updateDataPolicySchema>;

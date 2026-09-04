import { z } from "zod";

export const createFaqItemSchema = z.object({
  question: z.string().min(1, "Question must not be empty"),
  answer: z.string().min(1, "Answer must not be empty"),
  category: z.string().min(1).optional(),
  sortOrder: z.number().int().min(0).optional(),
  published: z.boolean().optional(),
});

export const updateFaqItemSchema = z.object({
  question: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  sortOrder: z.number().int().min(0).optional(),
  published: z.boolean().optional(),
});

export type CreateFaqItemSchema = z.infer<typeof createFaqItemSchema>;
export type UpdateFaqItemSchema = z.infer<typeof updateFaqItemSchema>;

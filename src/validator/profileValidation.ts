import { z } from "zod";

export const profileSchema = z.object({
  body: z.object({
    bio: z.string().max(500, "Bio too long").optional(),
    avatar: z.string().url().optional(),
    location: z.string().optional(),
    occupation: z.string().optional(),
    interests: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    experience: z
      .array(
        z.object({
          title: z.string(),
          company: z.string(),
          startDate: z.string(),
          endDate: z.string().optional(),
          description: z.string().optional(),
        }),
      )
      .optional(),
    education: z
      .array(
        z.object({
          degree: z.string(),
          institution: z.string(),
          year: z.string(),
        }),
      )
      .optional(),
    socialLinks: z
      .object({
        twitter: z.string().url().optional(),
        linkedin: z.string().url().optional(),
        github: z.string().url().optional(),
      })
      .optional(),
  }),
});

export const avatarSchema = z.object({
  body: z.object({
    avatarUrl: z.string().url("Invalid URL format"),
  }),
});

export type ProfileSchema = z.infer<typeof profileSchema>;
export type AvatarSchema = z.infer<typeof avatarSchema>;

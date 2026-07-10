import { z } from 'zod';

//  Codes from William
import { Request } from 'express';

declare global {
    namespace Express {
        interface Request {
        user?: {
            id: string;
        };
        }
    }
}

export const BasicInfoSchema = z.object({
    fullName: z.string().min(2, "Name must be at least 2 characters"),
    aboutMe: z.string().max(500, "Bio cannot exceed 500 characters").optional(),
    dateOfBirth: z.string().datetime("Invalid date format, use ISO string"), 
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
    height: z.number().positive("Height must be a positive number"),
    city: z.string().min(1, "City is required")
});

export const EducationCareerSchema = z.object({
    jobTitle: z.string().min(1, "Job title is required").optional(),
    company: z.string().optional(),
    educationLevel: z.enum(['HIGH_SCHOOL', 'UNDERGRADUATE', 'POSTGRADUATE', 'OTHER']).optional()
});

export const CulturalBackgroundSchema = z.object({
    nationality: z.string().optional(),
    religion: z.string().optional(),
    languagesSpoken: z.array(z.string()).default([])
});

export const RelationshipGoalsSchema = z.object({
    relationshipType: z.enum(['LONG_TERM', 'SHORT_TERM', 'CASUAL', 'FRIENDSHIP']),
    wantsChildren: z.boolean().optional()
});

export const PhotosSchema = z.object({
    profilePictureUrl: z.string().url("Must be a valid URL"),
    galleryUrls: z.array(z.string().url()).default([])
});

export type BasicInfo = z.infer<typeof BasicInfoSchema>;
export type EducationCareer = z.infer<typeof EducationCareerSchema>;
export type CulturalBackground = z.infer<typeof CulturalBackgroundSchema>;
export type RelationshipGoals = z.infer<typeof RelationshipGoalsSchema>;
export type Photos = z.infer<typeof PhotosSchema>;

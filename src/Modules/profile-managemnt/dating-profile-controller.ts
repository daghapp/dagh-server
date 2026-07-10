import  {Request,Response}  from 'express';
import { prisma } from 'src/config/prisma';
import { ZodError } from 'zod'; 
import { 
    BasicInfoSchema, 
    EducationCareerSchema, 
    CulturalBackgroundSchema, 
    RelationshipGoalsSchema, 
    PhotosSchema 
} from '../../types/dating-user-profile';

export class DatingProfileController {
    private getUserId = (req: Request): string => {
        if (!req.user || !req.user.id) {
            throw new Error("Authentication context missing");
        }
        return req.user.id;
    };

    private handleCatchError = (error: unknown, res: Response) => {
        if (error instanceof ZodError) {
        res.status(400).json({ success: false, errors: error.errors });
        return;
        }
        
        res.status(500).json({ success: false, error: "Database execution failed" });
    };

    public getCompleteProfile = async (req: Request, res: Response): Promise<void> => {
        try {
        const userId = this.getUserId(req);
        const profile = await prisma.datingUserProfile.findUnique({
            where: { userId }
        });

        if (!profile) {
            res.status(404).json({ success: false, error: "Dating profile registration not initialized." });
            return;
        }

        res.json({ success: true, data: profile });
        } catch (error) {
        this.handleCatchError(error, res);
        }
    };

    public syncBasicInfo = async (req: Request, res: Response): Promise<void> => {
        try {
        const userId = this.getUserId(req);
        const validated = BasicInfoSchema.parse(req.body);

        const payload = {
            fullName: validated.fullName,
            aboutMe: validated.aboutMe,
            dateOfBirth: new Date(validated.dateOfBirth),
            gender: validated.gender,
            height: validated.height,
            city: validated.city
        };

        const result = await prisma.datingUserProfile.upsert({
            where: { userId },
            update: payload,
            create: { userId, ...payload }
        });

        res.json({ success: true, message: "Basic Info updated", data: result });
        } catch (error) {
        this.handleCatchError(error, res);
        }
    };

    public syncEducationCareer = async (req: Request, res: Response): Promise<void> => {
        try {
        const userId = this.getUserId(req);
        const validated = EducationCareerSchema.parse(req.body);

        const result = await prisma.datingUserProfile.upsert({
            where: { userId },
            update: validated,
            create: { userId, ...validated }
        });

        res.json({ success: true, message: "Education & Career info updated", data: result });
        } catch (error) {
        this.handleCatchError(error, res);
        }
    };

    public syncCulturalBackground = async (req: Request, res: Response): Promise<void> => {
        try {
        const userId = this.getUserId(req);
        const validated = CulturalBackgroundSchema.parse(req.body);

        const result = await prisma.datingUserProfile.upsert({
            where: { userId },
            update: validated,
            create: { userId, ...validated }
        });

        res.json({ success: true, message: "Cultural background updated", data: result });
        } catch (error) {
        this.handleCatchError(error, res);
        return;
        }
    };

    public syncRelationshipGoals = async (req: Request, res: Response): Promise<void> => {
        try {
        const userId = this.getUserId(req);
        const validated = RelationshipGoalsSchema.parse(req.body);

        const result = await prisma.datingUserProfile.upsert({
            where: { userId },
            update: validated,
            create: { userId, ...validated }
        });

        res.json({ success: true, message: "Relationship goals updated", data: result });
        } catch (error) {
        this.handleCatchError(error, res);
        }
    };

    public syncPhotos = async (req: Request, res: Response): Promise<void> => {
        try {
        const userId = this.getUserId(req);
        const validated = PhotosSchema.parse(req.body);

        const result = await prisma.datingUserProfile.upsert({
            where: { userId },
            update: validated,
            create: { userId, ...validated }
        });

        res.json({ success: true, message: "Photos database mapping updated", data: result });
        } catch (error) {
        this.handleCatchError(error, res);
        }
    };
}

export const datingProfileController = new DatingProfileController();
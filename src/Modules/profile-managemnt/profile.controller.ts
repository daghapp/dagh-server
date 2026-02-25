//add to profile
//edit profile details
//view profile details
//delete profile

import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ProfileSchema, UpdateProfileSchema } from "../../validator/index.js";

export class ProfileController {
  // Get current user's profile
  async getProfile(req: Request, res: Response) {
    try {
      const user = req.user as { id: string; email: string; accountType: string } | undefined;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized access" });
      }
      
      const profile = await prisma.userProfile.findUnique({
        where: { userId: user.id },
      });
      
      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }
      
      return res.json(profile);
    } catch (error) {
      console.error("Error fetching profile:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch profile",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Create or update user profile
  async createOrUpdateProfile(req: Request, res: Response) {
    try {
      const profileData = req.body as ProfileSchema;
      //check if profile exists
      const existingProfile = await prisma.userProfile.findUnique({
        where: { userId: profileData.userId },
      });
      if (existingProfile) {
        return res
          .status(400)
          .json({
            message:
              "Unable to create profile for this user",
          });
      }

      const newProfile = await prisma.userProfile.create({
        data: profileData,
      });
      return res
        .status(201)
        .json({ message: "Profile created successfully", profile: newProfile });
    } catch (error) {
      console.error("Error creating/updating profile:", error);
      return res.status(500).json({
        success: false,
        message: "Registration failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

    // Get user profile by user ID
  async getProfileByUserId(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const profile = await prisma.userProfile.findUnique({
        where: { userId: userId },
      });
      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }
      return res.json(profile);
    } catch (error) {
      console.error("Error fetching profile:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch profile",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  //update profile details
  async updateProfile(req: Request, res: Response) {
    try{
    const updateData = req.body as UpdateProfileSchema;
      const user = req.user as { id: string; email: string; accountType: string } | undefined;
     if (!user) {
        return res.status(401).json({ message: "Unauthorized access" });
      }
      const userId = user.id;
      const updatedProfile = await prisma.userProfile.update({
        where: { userId: userId },
        data: updateData,
      });
      return res.json({ message: "Profile updated successfully", profile: updatedProfile });
    } catch (error) {
      console.error("Error updating profile:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update profile",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Delete current user's profile
  async deleteProfile(req: Request, res: Response) {
    try {
      const user = req.user as { id: string; email: string; accountType: string } | undefined;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized access" });
      }

      const profile = await prisma.userProfile.findUnique({
        where: { userId: user.id },
      });

      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }

      await prisma.userProfile.delete({
        where: { userId: user.id },
      });

      return res.json({ message: "Profile deleted successfully" });
    } catch (error) {
      console.error("Error deleting profile:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete profile",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

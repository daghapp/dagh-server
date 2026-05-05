import { Request, Response } from 'express'
import { prisma } from '../lib/prisma'

export const createOrUpdateProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user.id
    const { bio, avatar, location, occupation, interests, skills, experience, education, socialLinks } = req.body

    const profile = await prisma.profile.upsert({
      where: { userId },
      update: {
        bio,
        avatar,
        location,
        occupation,
        interests,
        skills,
        experience,
        education,
        socialLinks,
      },
      create: {
        userId,
        bio,
        avatar,
        location,
        occupation,
        interests: interests || [],
        skills: skills || [],
        experience: experience || [],
        education: education || [],
        socialLinks: socialLinks || {},
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true
          }
        }
      }
    })

    res.json({
      success: true,
      data: profile
    })
  } catch (error) {
    console.error('Profile error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to create/update profile'
    })
  }
}

export const getProfile = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params
    
    const profile = await prisma.profile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true
          }
        }
      }
    })

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'Profile not found'
      })
    }

    res.json({
      success: true,
      data: profile
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile'
    })
  }
}

export const getMyProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user.id
    
    const profile = await prisma.profile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true
          }
        }
      }
    })

    res.json({
      success: true,
      data: profile || null
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile'
    })
  }
}

export const uploadAvatar = async (req: Request, res: Response) => {
  try {
    const userId = req.user.id
    const { avatarUrl } = req.body

    const profile = await prisma.profile.upsert({
      where: { userId },
      update: { avatar: avatarUrl },
      create: {
        userId,
        avatar: avatarUrl,
        interests: [],
        skills: [],
        experience: [],
        education: [],
        socialLinks: {}
      }
    })

    res.json({
      success: true,
      data: profile
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to upload avatar'
    })
  }
}
// src/controllers/authController.ts
import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'

export const register = async (req: Request, res: Response) => {
  // ... your register code
}

export const login = async (req: Request, res: Response) => {
  // ... your login code
}
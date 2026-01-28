import { Response, Request } from "express";
import { RegistrationSchema, LoginSchema } from "../../validator";
import { prisma } from "../../config/index";
import bcrypt from "bcrypt";
import { sendOtp , generateAccessToken, generateRefreshToken} from "../../helpers/index";


export class PasswordAuthController {
  async register(req: Request, res: Response) {
    try {
      const userData = req.body as RegistrationSchema;

      const userExists = await prisma.user.findUnique({
        where: { email: userData.email },
      });

      if (userExists) {
        return res
          .status(400)
          .json({ success: false, message: "User already exists" });
      }

      const hashedPassword = bcrypt.hashSync(userData.password, 10);
      const newUser = await prisma.user.create({
        data: {
          authProvider: "PASSWORD",
          fullName: userData.fullName,
          email: userData.email,
          phoneNumber: userData.phoneNumber,
          dateOfBirth: userData.dateOfBirth
            ? new Date(userData.dateOfBirth)
            : undefined,
          gender: userData.gender,
          passwordHash: hashedPassword,
        },
      });
      
      await  sendOtp({ email: newUser.email, subject: "Verify Your Email" });
      return res.status(201).json({ success: true, data: newUser });
    } catch (error) {
      console.error("Registration error:", error);
      return res.status(500).json({
        success: false,
        message: "Registration failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  //log in new user
  async login(req: Request, res: Response) {
    try {
      const loginData = req.body as LoginSchema;

      const user = await prisma.user.findFirst({
        where: { 
          OR: [
            { email: loginData.email },
            { phoneNumber: loginData.email }
          ]
         },
      });

      if (!user || !user.passwordHash) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid email or password" });
      }

      const passwordMatch = bcrypt.compareSync(
        loginData.password,
        user.passwordHash,
      );
      if (!passwordMatch) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid email or password" });
      }

      const accessToken = generateAccessToken({
        id: user.id,
        email: user.email,
        accountType: user.accountType,
    
      })
      const refreshToken = await generateRefreshToken({
        id: user.id,
        email: user.email,
        accountType: user.accountType,
      })

      return res.status(200).json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          accountType: user.accountType,
          accessToken,
          refreshToken,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      return res.status(500).json({
        success: false,
        message: "Login failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

import {date, email, z} from 'zod';





export const loginSchema = z.object({
    email: z.string().email({ message: 'Invalid email address' }),
    password: z.string().min(6, { message: 'Password must be at least 6 characters long' })
});


export const registrationSchema = z.object({
    fullName: z.string().min(2, { message: 'Full name must be at least 2 characters long' }),
    phoneNumber: z.string().e164("Phone number must be in E.164 format"),
    gender: z.string().toUpperCase(),
    dateOfBirth: z.iso.date({ message: 'Invalid date of birth' }),
    email: z.string().email({ message: 'Invalid email address' }),
    password: z.string().min(6, { message: 'Password must be at least 6 characters long' })
    .regex(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
    .regex(/[a-z]/, { message: 'Password must contain at least one lowercase letter' })
    .regex(/[0-9]/, { message: 'Password must contain at least one number' })
    .regex(/[\W_]/, { message: 'Password must contain at least one special character' })
})



export type LoginSchema = z.infer<typeof loginSchema>;
export type RegistrationSchema = z.infer<typeof registrationSchema>;
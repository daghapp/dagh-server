//profirl shema 
//url, membership status, email , user-name,firstname , lastname
import { z } from 'zod';
export const profileSchema = z.object({
    username: z.string().min(3, { message: 'Username must be at least 3 characters long' }),
    firstName: z.string().min(2, { message: 'First name must be at least 2 characters long' }),
    lastName: z.string().min(2, { message: 'Last name must be at least 2 characters long' }),
    email: z.string().email({ message: 'Invalid email address' }),
    profileUrl: z.string().url({ message: 'Invalid URL format' }).optional(),
    membershipStatus: z.enum(['FREE', 'PREMIUM', 'VIP'], { message: 'Invalid membership status' })
});

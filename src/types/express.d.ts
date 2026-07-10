declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      accountType: string;
      fullName: string;
    }
    interface Request {
      user?: User;
    }
  }
}

//  Codes from William
// import { Request } from 'express';

// declare global {
//   namespace Express {
//     interface Request {
//       user?: {
//         id: string;
//       };
//     }
//   }
// }

export {};

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

export {};

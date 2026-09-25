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
      /**
       * Correlation id for this request, set by the requestId middleware. Echoed
       * back as the X-Request-Id response header and recorded on audit rows so
       * a support ticket can be traced to server logs.
       */
      requestId?: string;
    }
  }
}

export {};

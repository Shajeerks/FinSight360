import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
    } & DefaultSession["user"];
  }
  interface User {
    role?: string;
    sessionVersion?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    sv?: number;
    role?: string;
  }
}

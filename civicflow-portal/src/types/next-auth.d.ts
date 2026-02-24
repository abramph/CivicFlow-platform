import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    id: string;
    org_id: string;
    api_key: string;
    api_base: string;
  }

  interface Session {
    org_id: string;
    api_key: string;
    api_base: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    org_id?: string;
    api_key?: string;
    api_base?: string;
  }
}

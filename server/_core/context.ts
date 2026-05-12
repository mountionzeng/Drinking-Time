import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

const authDisabled =
  process.env.DISABLE_AUTH === "true" ||
  process.env.NODE_ENV !== "production";

function createGuestUser(): User {
  const now = new Date();
  return {
    id: 1,
    openId: "local-guest",
    name: "Local Guest",
    email: null,
    loginMethod: "local",
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  if (!authDisabled) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch (error) {
      // Authentication is optional for public procedures.
      user = null;
    }
  } else {
    user = createGuestUser();
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}

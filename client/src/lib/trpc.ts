import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../server/routers";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export const trpc = createTRPCReact<AppRouter>();

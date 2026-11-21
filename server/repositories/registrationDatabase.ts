import { ENV } from "../_core/env";
import { getDb } from "./runtime";

export class RegistrationStorageUnavailable extends Error {
  constructor() {
    super("registration_storage_unavailable");
  }
}

/** Local development and tests can use the existing in-memory store. */
export async function registrationDatabase() {
  const db = await getDb({ allowLocalFallback: !ENV.isProduction });
  if (!db && ENV.isProduction) throw new RegistrationStorageUnavailable();
  return db;
}

import argon2 from "argon2";
import type { Logger } from "../logger.js";

export async function verifyPassword(
  hash: string,
  password: string,
  logger: Logger,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch (err) {
    // A malformed configured hash must not reveal itself to the caller.
    logger.error({ err }, "password hash could not be verified; check APP_ADMIN_PASSWORD_HASH");
    return false;
  }
}

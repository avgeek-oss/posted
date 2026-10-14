import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { sql } from "../../../../packages/database/src/index.js";

export function installationSetupSecret() {
  return createHmac("sha256", config().POSTED_SECRET)
    .update("posted:installation-setup:v1")
    .digest("base64url");
}
export function validInstallationSetupSecret(value: string) {
  const expected = Buffer.from(installationSetupSecret());
  const supplied = Buffer.from(value);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
export async function reportInstallationSetupSecret() {
  const [state] =
    await sql`SELECT EXISTS(SELECT 1 FROM workspace) AS configured`;
  if (!state.configured)
    console.log(
      `Posted installation setup secret: ${installationSetupSecret()}`,
    );
}

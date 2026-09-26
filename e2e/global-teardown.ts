import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export default async function globalTeardown() {
  const testRoot = process.env.PROMPTDOCK_E2E_ROOT;
  if (
    !testRoot ||
    path.dirname(testRoot) !== os.tmpdir() ||
    !path.basename(testRoot).startsWith("promptdock-e2e-")
  ) {
    throw new Error("Refusing to clean an unrecognized E2E test directory.");
  }
  await rm(testRoot, { recursive: true, force: true });
}

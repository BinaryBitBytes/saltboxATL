import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const SECRET_PATH = path.join(process.cwd(), "data", ".session-secret");

let cached: string | undefined;

export function getSessionSecret(): string {
  if (cached) return cached;

  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) {
    cached = fromEnv;
    return cached;
  }

  try {
    if (existsSync(SECRET_PATH)) {
      const fromFile = readFileSync(SECRET_PATH, "utf8").trim();
      if (fromFile.length >= 16) {
        cached = fromFile;
        return cached;
      }
    }
  } catch {
    // Fall through and generate a secret for this process.
  }

  const generated = randomBytes(32).toString("hex");
  try {
    mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
    writeFileSync(SECRET_PATH, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Still usable in-memory for this process.
  }

  cached = generated;
  return cached;
}

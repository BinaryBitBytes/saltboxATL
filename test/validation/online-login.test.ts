import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/auth/demo-accounts";
import { connectionIsSecure, sessionCookieOptions } from "@/lib/auth/token";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function buildIsStale(): boolean {
  const buildId = path.join(ROOT, ".next", "BUILD_ID");
  if (!fs.existsSync(buildId)) return true;
  const built = fs.statSync(buildId).mtimeMs;
  const watched = [
    "lib/auth/token.ts",
    "app/api/auth/login/route.ts",
    "frontend/client/login-form.tsx",
    "lib/auth/demo-accounts.ts",
    "proxy.ts",
  ];
  return watched.some((file) => fs.statSync(path.join(ROOT, file)).mtimeMs > built);
}

describe("session cookie on http and https", () => {
  it("does not mark the session Secure for an http request", () => {
    const request = new Request("http://127.0.0.1:3000/api/auth/login");
    expect(connectionIsSecure(request)).to.equal(false);
    expect(sessionCookieOptions(request).secure).to.equal(false);
  });

  it("marks the session Secure for https and forwarded https", () => {
    const https = new Request("https://saltbox.example/api/auth/login");
    expect(connectionIsSecure(https)).to.equal(true);
    expect(sessionCookieOptions(https).secure).to.equal(true);

    const proxied = new Request("http://internal/api/auth/login", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(connectionIsSecure(proxied)).to.equal(true);

    const plain = new Request("https://saltbox.example/api/auth/login", {
      headers: { "x-forwarded-proto": "http" },
    });
    expect(connectionIsSecure(plain)).to.equal(false);
  });

  it("fills demo sign-in with the full email, including the domain", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "frontend/client/login-form.tsx"),
      "utf8",
    );
    expect(source).to.include("setIdentifier(account.email)");
    expect(source).to.not.include("setIdentifier(account.username)");
    for (const account of DEMO_ACCOUNTS) {
      expect(account.email.endsWith("@saltbox.local"), account.username).to.equal(true);
      expect(account.email.startsWith(`${account.username}@`)).to.equal(true);
    }
  });
});

describe("online sign-in", function () {
  this.timeout(180_000);
  let server: ChildProcess | undefined;
  let base = "";

  before(async () => {
    if (buildIsStale()) {
      await execFileAsync("npm", ["run", "build"], { cwd: ROOT });
    }
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    const log = fs.openSync("/tmp/saltbox-next-start-test.log", "w");
    server = spawn(
      "npm",
      ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(port)],
      { cwd: ROOT, stdio: ["ignore", log, log] },
    );
    const deadline = Date.now() + 30_000;
    let lastError = "server did not start";
    while (Date.now() < deadline) {
      if (server.exitCode != null) {
        throw new Error(`next start exited ${server.exitCode}`);
      }
      try {
        const response = await fetch(`${base}/login`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) return;
        lastError = `login page status ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(lastError);
  });

  after(() => {
    server?.kill("SIGTERM");
  });

  it("shows every demo email on the login page", async () => {
    const html = await (await fetch(`${base}/login`)).text();
    for (const account of DEMO_ACCOUNTS) {
      expect(html, account.email).to.include(account.email);
    }
    expect(html).to.include(DEMO_PASSWORD);
  });

  for (const account of DEMO_ACCOUNTS) {
    it(`signs in ${account.role} while the server is running`, async () => {
      const response = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifier: account.email,
          password: DEMO_PASSWORD,
        }),
      });
      const body = (await response.json()) as {
        success?: boolean;
        error?: string;
        data?: { email?: string; role?: string };
      };
      expect(response.status, body.error).to.equal(200);
      expect(body.success, body.error).to.equal(true);
      expect(body.data?.email).to.equal(account.email);
      expect(body.data?.role).to.equal(account.role);

      const sessionCookie = response.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("saltbox_session="));
      expect(sessionCookie, "session cookie").to.be.a("string");
      expect(sessionCookie!.toLowerCase()).to.not.match(/;\s*secure(?:;|$)/);

      const cookie = sessionCookie!.split(";")[0];
      const me = await fetch(`${base}/api/auth/me`, {
        headers: { cookie },
      });
      expect(me.status).to.equal(200);
      const profile = (await me.json()) as { data?: { role?: string } };
      expect(profile.data?.role).to.equal(account.role);

      const home = await fetch(`${base}/`, {
        headers: { cookie },
        redirect: "manual",
      });
      expect(home.status).to.equal(200);
      const page = await home.text();
      expect(page).to.include("Dashboard");
      expect(page).to.not.include("Account access");
    });
  }

  it("also accepts the username without the email domain", async () => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: "coordinator",
        password: DEMO_PASSWORD,
      }),
    });
    expect(response.status).to.equal(200);
    const body = (await response.json()) as { data?: { email?: string } };
    expect(body.data?.email).to.equal("coordinator@saltbox.local");
  });
});

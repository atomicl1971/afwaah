import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import bcrypt from "bcryptjs";
import pg from "pg";

const { Client } = pg;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const rootDir = path.resolve(appDir, "../..");

loadDotenv(path.join(rootDir, ".env"));
loadDotenv(path.join(appDir, ".env"));

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

const databaseUrl =
  process.env.ADMIN_BOOTSTRAP_DATABASE_URL ??
  process.env.MIGRATION_DATABASE_URL ??
  process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "DATABASE_URL or ADMIN_BOOTSTRAP_DATABASE_URL is required to bootstrap an admin user.",
  );
  process.exit(1);
}

const email = (
  process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@campus.local"
)
  .trim()
  .toLowerCase();
const displayName = (
  process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME ?? "Campus Admin"
).trim();
const role = (process.env.ADMIN_BOOTSTRAP_ROLE ?? "super_admin").trim();
const providedPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const password = providedPassword ?? generatePassword();
const mustChangePassword = booleanEnv(
  process.env.ADMIN_BOOTSTRAP_MUST_CHANGE_PASSWORD,
  false,
);

if (!isValidEmail(email)) {
  console.error("ADMIN_BOOTSTRAP_EMAIL must be a valid email address.");
  process.exit(1);
}

if (!displayName || displayName.length > 100) {
  console.error("ADMIN_BOOTSTRAP_DISPLAY_NAME must be 1-100 characters.");
  process.exit(1);
}

if (!["moderator", "admin", "super_admin"].includes(role)) {
  console.error("ADMIN_BOOTSTRAP_ROLE must be moderator, admin, or super_admin.");
  process.exit(1);
}

if (password.length < 12) {
  console.error("ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters.");
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();

  const passwordHash = await bcrypt.hash(password, 12);
  await client.query("BEGIN");

  const existing = await client.query(
    "SELECT id FROM admin.admin_users WHERE LOWER(email) = LOWER($1) LIMIT 1;",
    [email],
  );

  let adminId;
  let action;

  if (existing.rowCount) {
    adminId = existing.rows[0].id;
    action = "updated";
    await client.query(
      `
        UPDATE admin.admin_users
        SET
          password_hash = $2,
          display_name = $3,
          role = $4,
          is_active = TRUE,
          failed_login_attempts = 0,
          locked_until = NULL,
          must_change_password = $5,
          password_changed_at = NOW(),
          updated_at = NOW()
        WHERE id = $1;
      `,
      [adminId, passwordHash, displayName, role, mustChangePassword],
    );
  } else {
    action = "created";
    const inserted = await client.query(
      `
        INSERT INTO admin.admin_users (
          email,
          password_hash,
          display_name,
          role,
          permissions,
          is_active,
          must_change_password
        )
        VALUES ($1, $2, $3, $4, '[]'::jsonb, TRUE, $5)
        RETURNING id;
      `,
      [email, passwordHash, displayName, role, mustChangePassword],
    );
    adminId = inserted.rows[0].id;
  }

  await client.query("COMMIT");

  console.log(`Admin ${action}.`);
  console.log(`Email: ${email}`);
  console.log(`Role: ${role}`);
  console.log(`Admin ID: ${adminId}`);
  if (providedPassword) {
    console.log("Password: value from ADMIN_BOOTSTRAP_PASSWORD");
  } else {
    console.log(`Password: ${password}`);
    console.log("Store this password now. It is not saved in plaintext.");
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Failed to bootstrap admin user.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

function generatePassword() {
  return `Campus-${randomBytes(18).toString("base64url")}#26`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 255;
}

function booleanEnv(value, fallback) {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function loadDotenv(envPath) {
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

function shouldUseSsl(connectionString) {
  try {
    const url = new URL(connectionString);
    return (
      url.searchParams.get("sslmode") === "require" ||
      url.hostname.endsWith(".neon.tech")
    );
  } catch {
    return connectionString.includes("sslmode=require");
  }
}

function printHelp() {
  console.log(`
Bootstrap a super admin user.

Environment:
  DATABASE_URL                         Postgres connection string
  ADMIN_BOOTSTRAP_DATABASE_URL          Optional override for DATABASE_URL
  ADMIN_BOOTSTRAP_EMAIL                 Default: admin@campus.local
  ADMIN_BOOTSTRAP_PASSWORD              Optional. Generated if omitted.
  ADMIN_BOOTSTRAP_DISPLAY_NAME          Default: Campus Admin
  ADMIN_BOOTSTRAP_ROLE                  Default: super_admin
  ADMIN_BOOTSTRAP_MUST_CHANGE_PASSWORD  Default: false

Example:
  ADMIN_BOOTSTRAP_EMAIL=admin@campus.local \\
  ADMIN_BOOTSTRAP_PASSWORD='replace-with-a-long-password' \\
  pnpm --filter @campus-chat/api admin:bootstrap
`);
}

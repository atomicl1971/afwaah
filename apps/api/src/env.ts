import { z } from "zod";

const booleanStringSchema = z
  .enum(["true", "false", "1", "0", "yes", "no"])
  .transform((value) => ["true", "1", "yes"].includes(value));

const envSchema = z.object({
  ADMIN_COOKIE_NAME: z.string().min(1).default("campus_admin_session"),
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(43200),
  CORS_ORIGINS: z
    .string()
    .min(1)
    .default("http://localhost:3000,http://127.0.0.1:3000"),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://postgres:postgres@127.0.0.1:5433/campus_chat"),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOCATION_IP_FALLBACK_ENABLED: booleanStringSchema.default("false"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  POSTGRES_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  REDIS_ENABLE_READY_CHECK: booleanStringSchema.default("false"),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  SESSION_COOKIE_NAME: z.string().min(1).default("campus_session"),
  TRUST_PROXY: booleanStringSchema.default("true"),
});

export type ApiEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = envSchema.safeParse(source);
  if (parsed.success) return parsed.data;

  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid API environment: ${details}`);
}

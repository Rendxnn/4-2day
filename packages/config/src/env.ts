import { z } from "zod";

export const appEnvSchema = z.object({
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  APP_BASE_URL: z.string().url().optional(),
  DYNAMIC_LINK_BASE_URL: z.string().url().optional(),
  DASHBOARD_ALLOWED_ORIGINS: z.string().optional(),

  META_VERIFY_TOKEN: z.string().min(1),
  META_ACCESS_TOKEN: z.string().min(1),
  META_PHONE_NUMBER_ID: z.string().min(1),
  META_WABA_ID: z.string().min(1),
  META_GRAPH_API_VERSION: z.string().default("v22.0"),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
});

export type AppEnv = z.infer<typeof appEnvSchema>;

export function parseAppEnv(input: unknown): AppEnv {
  return appEnvSchema.parse(input);
}

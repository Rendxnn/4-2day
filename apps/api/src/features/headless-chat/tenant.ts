import type { Tenant } from "@42day/types";
import type { ApiBindings } from "../../lib/bindings";
import { createSupabaseRestClient } from "../../lib/supabase-rest.ts";
import type { JournalFile, JournalSession } from "./session-journal";

export type HeadlessEnvironment = {
  appEnv: "local";
  debug: true;
  projectId: string;
  supabaseUrl: string;
  apiPort: number;
  dbPort: number;
  schemas: string[];
};

export function validateHeadlessEnvironment(input: {
  env: ApiBindings;
  configText: string;
}): HeadlessEnvironment {
  if (input.env.APP_ENV !== "local" || input.env.PARAHOY_HEADLESS_DEBUG !== "true") {
    throw new Error("HEADLESS_DISABLED");
  }

  const projectId = input.env.PARAHOY_HEADLESS_LOCAL_PROJECT_ID;
  const expectedProjectId = readTomlString(input.configText, "project_id");
  const apiPort = readTomlNumber(input.configText, "port", 54321);
  const dbPort = readTomlNumber(input.configText, "port", 54322, "[db]");
  const schemas = readTomlArray(input.configText, "schemas", "[api]");
  const url = new URL(input.env.SUPABASE_URL);

  if (!projectId || !expectedProjectId || projectId !== expectedProjectId) {
    throw new Error("UNAUTHORIZED_TARGET_ENV");
  }
  if (!isLoopback(url.hostname) || url.port !== String(apiPort)) {
    throw new Error("UNAUTHORIZED_TARGET_ENV");
  }
  if (!schemas.includes("control") || !schemas.includes("tenant_template")) {
    throw new Error("UNAUTHORIZED_TARGET_ENV");
  }

  return { appEnv: "local", debug: true, projectId, supabaseUrl: input.env.SUPABASE_URL, apiPort, dbPort, schemas };
}

export async function resolveHeadlessTenant(input: {
  env: ApiBindings;
  slug: string;
  exposedSchemas?: string[];
}): Promise<Tenant> {
  const [row] = await createSupabaseRestClient(input.env).select<{
    id: string;
    name: string;
    slug: string;
    schema_name: string;
    status: Tenant["status"];
    timezone: string;
    currency: string;
    automation_enabled: boolean;
  }>({
    schema: "control",
    table: "tenants",
    query: {
      select: "id,name,slug,schema_name,status,timezone,currency,automation_enabled",
      slug: `eq.${input.slug}`,
      limit: 1,
    },
  });

  if (!row || !/^tenant_[a-z0-9_]+$/.test(row.schema_name)) {
    throw new Error("TENANT_NOT_FOUND");
  }
  if (input.exposedSchemas && !input.exposedSchemas.includes(row.schema_name)) {
    throw new Error("UNAUTHORIZED_TARGET_ENV");
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    schemaName: row.schema_name,
    status: row.status,
    timezone: row.timezone,
    currency: row.currency,
    automationEnabled: row.automation_enabled,
  };
}

/**
 * A journal binding is valid only for the tenant and local project that created
 * it, and only for a synthetic headless identity. Callers intentionally receive
 * the same not-found error for every mismatch to prevent enumeration.
 */
export function assertHeadlessSessionBinding(input: {
  journal: JournalFile;
  session: JournalSession;
  tenant: Tenant;
  localProjectId: string;
}): void {
  const identity = input.journal.identities.find((candidate) => candidate.id === input.session.identityId);
  if (
    !identity
    || identity.tenantId !== input.tenant.id
    || identity.origin !== "headless"
    || identity.tenantSlug !== input.tenant.slug
    || identity.localProjectId !== input.localProjectId
  ) {
    throw new Error("SESSION_NOT_FOUND");
  }
  if (
    input.session.tenantId !== input.tenant.id
    || input.session.tenantSlug !== input.tenant.slug
    || input.session.localProjectId !== input.localProjectId
    || input.session.customerId !== identity.customerId
  ) {
    throw new Error("SESSION_NOT_FOUND");
  }
}

function readTomlString(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m"));
  return match?.[1];
}

function readTomlNumber(text: string, key: string, fallback: number, section?: string): number {
  const source = section ? text.slice(text.indexOf(section)) : text;
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)`, "m"));
  return match?.[1] ? Number(match[1]) : fallback;
}

function readTomlArray(text: string, key: string, section: string): string[] {
  const source = text.slice(text.indexOf(section));
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m"));
  return match?.[1]?.match(/["']([^"']+)["']/g)?.map((value) => value.slice(1, -1)) ?? [];
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

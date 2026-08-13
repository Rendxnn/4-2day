import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeHeadlessCommand } from "../src/features/headless-chat/application.ts";
import { emptyJournal, validateJournal } from "../src/features/headless-chat/session-journal.ts";

const apiDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(apiDirectory, "../../..");
const envPath = join(apiDirectory, "../.env.headless.local");
const configPath = join(repositoryRoot, "supabase/config.toml");
const journalPath = process.env.PARAHOY_HEADLESS_JOURNAL_PATH ?? join(apiDirectory, "../.headless-journal/journal.json");

// The CLI contract reserves stdout for one JSON envelope. Route structured
// diagnostics emitted by the shared worker code to stderr instead.
console.info = console.error;
console.debug = console.error;

async function main() {
  const [envText, configText, inputText] = await Promise.all([
    readFile(envPath, "utf8").catch(() => ""),
    readFile(configPath, "utf8"),
    readStdin(),
  ]);
  const env = parseEnv(envText);
  const input = JSON.parse(inputText);
  const result = await executeHeadlessCommand({
    env,
    configText,
    journal: createFileJournalStore(journalPath),
  }, input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === "failed" || result.status === "indeterminate" ? 1 : result.status === "rejected" ? 2 : 0;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return {
    APP_ENV: values.APP_ENV ?? "",
    PARAHOY_HEADLESS_DEBUG: values.PARAHOY_HEADLESS_DEBUG,
    PARAHOY_HEADLESS_LOCAL_PROJECT_ID: values.PARAHOY_HEADLESS_LOCAL_PROJECT_ID,
    SUPABASE_URL: values.SUPABASE_URL ?? "",
    SUPABASE_SERVICE_ROLE_KEY: values.SUPABASE_SERVICE_ROLE_KEY ?? "",
    SUPABASE_ANON_KEY: values.SUPABASE_ANON_KEY,
    META_VERIFY_TOKEN: values.META_VERIFY_TOKEN ?? "",
    META_ACCESS_TOKEN: values.META_ACCESS_TOKEN ?? "",
    META_PHONE_NUMBER_ID: values.META_PHONE_NUMBER_ID ?? "",
    META_WABA_ID: values.META_WABA_ID ?? "",
    GEMINI_API_KEY: values.GEMINI_API_KEY,
    GEMINI_MODEL: values.GEMINI_MODEL,
    OPENROUTER_API_KEY: values.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: values.OPENROUTER_MODEL,
  };
}

function createFileJournalStore(path) {
  async function readJournal() {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      return validateJournal(parsed);
    } catch (error) {
      if (error?.code === "ENOENT") return emptyJournal();
      throw error;
    }
  }

  async function writeJournal(value) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tempPath = `${path}.${process.pid}.tmp`;
    const tempHandle = await open(tempPath, "w", 0o600);
    try {
      await tempHandle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
      await tempHandle.sync();
    } finally {
      await tempHandle.close();
    }
    await rename(tempPath, path);
  }

  async function updateWithLock(update) {
    const lockPath = `${path}.lock`;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    let handle;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        handle = await open(lockPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        if (await canRecoverStaleLock(lockPath)) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 10 + attempt * 5));
      }
    }
    if (!handle) throw new Error("LOCK_UNAVAILABLE");
    try {
      const journal = await readJournal();
      const result = await update(journal);
      await writeJournal(journal);
      return result;
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  async function withSessionLock(sessionId, operation) {
    const lockDirectory = join(dirname(path), "sessions");
    const lockPath = join(lockDirectory, `${encodeURIComponent(sessionId)}.lock`);
    await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
    let handle;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      try {
        handle = await open(lockPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, sessionId, createdAt: new Date().toISOString() }));
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        if (await canRecoverStaleLock(lockPath)) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    if (!handle) throw new Error("LOCK_UNAVAILABLE");
    try {
      return await operation();
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  return { read: readJournal, write: writeJournal, update: updateWithLock, withSessionLock };
}

async function canRecoverStaleLock(lockPath) {
  try {
    const metadata = JSON.parse(await readFile(lockPath, "utf8"));
    const lockAge = Date.now() - Date.parse(metadata.createdAt);
    if (!Number.isFinite(lockAge) || lockAge < 120_000) return false;
    if (typeof metadata.pid === "number") {
      try {
        process.kill(metadata.pid, 0);
        return false;
      } catch (error) {
        if (error?.code !== "ESRCH") return false;
      }
    }
    return true;
  } catch {
    const details = await stat(lockPath).catch(() => undefined);
    return Boolean(details && Date.now() - details.mtimeMs >= 120_000);
  }
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    version: 1,
    command: "unknown",
    status: "rejected",
    tenant: null,
    session: null,
    turn: null,
    responses: [],
    before: null,
    after: null,
    routing: null,
    effects: [],
    warnings: [],
    error: { code: "INVALID_JSON", category: "input", retriable: false, safeMessage: "La entrada no es válida." },
  })}\n`);
  process.exitCode = 2;
});

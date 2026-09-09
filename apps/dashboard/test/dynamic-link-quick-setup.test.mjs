import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const inventoryPath = new URL("../src/features/admin/DynamicLinksSection.tsx", import.meta.url);
const quickSetupPath = new URL("../src/features/admin/QuickDynamicLinkSetup.tsx", import.meta.url);
const scannerPath = new URL("../src/features/admin/DynamicLinkQrScanner.tsx", import.meta.url);

test("quick setup is reachable from the inventory and has a mobile sticky action", async () => {
  const inventory = await readFile(inventoryPath, "utf8");
  assert.match(inventory, /Configuración rápida/);
  assert.match(inventory, /fixed bottom-5 right-5/);
  assert.match(inventory, /<QuickDynamicLinkSetup/);
});

test("quick setup keeps camera input safe and provides manual, atomic configuration paths", async () => {
  const [quickSetup, scanner] = await Promise.all([readFile(quickSetupPath, "utf8"), readFile(scannerPath, "utf8")]);
  assert.match(scanner, /void import\("@zxing\/browser"\)/);
  assert.match(scanner, /stop\?\.\(\)/);
  assert.match(scanner, /visibilitychange/);
  assert.match(quickSetup, /parseDynamicLinkReference\(value, permanentBaseUrl\)/);
  assert.match(quickSetup, /quickConfigureDynamicLink/);
  assert.match(quickSetup, /Guardar y activar/);
  assert.match(quickSetup, /Copiar enlace para NFC/);
  assert.match(quickSetup, /association === "preserve"/);
  assert.match(quickSetup, /tenantId: association === "clear" \? null : association/);
  assert.match(quickSetup, /phase === "confirm"/);
});

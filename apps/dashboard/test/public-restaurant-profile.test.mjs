import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../src/App.tsx", import.meta.url);
const profilePath = new URL("../src/features/public-profile/PublicRestaurantProfilePage.tsx", import.meta.url);
const settingsPath = new URL("../src/features/configuration/RestaurantPublicProfileSection.tsx", import.meta.url);
const conciergePath = new URL("../src/features/public-carta/PublicCartaConcierge.tsx", import.meta.url);

test("resolves a short restaurant profile route before authenticated dashboard views", async () => {
  const app = await readFile(appPath, "utf8");
  assert.match(app, /window\.location\.pathname\.startsWith\("\/r\/"\)/);
  assert.match(app, /<PublicRestaurantProfilePage tenantSlug=\{getPublicRestaurantProfileTenantSlug\(\)\}/);
  assert.match(app, /href=\{`\/r\/\$\{encodeURIComponent\(tenantSlug\)\}`\}/);
});

test("public restaurant page includes menu, contact, directions, survey placeholder and sharing", async () => {
  const profile = await readFile(profilePath, "utf8");
  assert.match(profile, /Ver menú digital/);
  assert.match(profile, /Escríbenos por WhatsApp/);
  assert.match(profile, /Cómo llegar/);
  assert.match(profile, /Encuesta de servicio/);
  assert.match(profile, /Próximamente/);
  assert.match(profile, /navigator\.share/);
});

test("restaurant settings support social media and future Forms redirect", async () => {
  const settings = await readFile(settingsPath, "utf8");
  assert.match(settings, /instagramUrl/);
  assert.match(settings, /facebookUrl/);
  assert.match(settings, /tiktokUrl/);
  assert.match(settings, /mapsUrl/);
  assert.match(settings, /surveyUrl/);
  assert.match(settings, /Google Forms/);
});

test("AI waiter uses the clean transparent ParaHoy brand asset", async () => {
  const concierge = await readFile(conciergePath, "utf8");
  assert.match(concierge, /src="\/logo-sin-fondo\.png"/);
  assert.doesNotMatch(concierge, /parahoy-mesero|scale-\[1\.38\]/);
});

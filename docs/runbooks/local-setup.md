# Setup local

## Requisitos

- Node.js 22 o superior.
- pnpm 9.15.0.
- Acceso a un proyecto de Supabase de desarrollo.
- Credenciales de Meta y proveedores externos solo para probar esas integraciones.

Instala dependencias desde la raíz:

```bash
pnpm install
```

Si pnpm no está disponible, instala la versión declarada en `package.json` o usa los helpers de `scripts/bash`, que intentan pnpm, Corepack y luego `npm exec`.

## Variables

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/dashboard/.env.example apps/dashboard/.env.local
```

Completa valores locales sin versionarlos. Los grupos principales son:

- API/entorno: `APP_ENV`, `APP_BASE_URL`, `DASHBOARD_ALLOWED_ORIGINS`.
- Meta: `META_VERIFY_TOKEN`, `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_WABA_ID`, `META_GRAPH_API_VERSION`.
- Supabase: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y, si el flujo lo necesita, `DATABASE_URL`.
- IA/audio: Gemini, OpenRouter, OpenAI o Hugging Face según configuración.
- Geocoding: clave server-side para API y clave restringida por referrer para dashboard.

Nunca pongas `SUPABASE_SERVICE_ROLE_KEY` ni claves de IA en variables `VITE_*`.

## Supabase

1. Confirma CLI con `supabase --version` y consulta `supabase --help`.
2. Enlaza únicamente el proyecto de desarrollo apropiado.
3. Aplica el historial de `supabase/migrations` con el workflow vigente del equipo.
4. Provisiona o valida un tenant de prueba desde `tenant_template`.
5. Confirma schemas expuestos, grants, RLS, Realtime y buckets necesarios.

No ejecutes `packages/db/migrations` ni seeds históricos como procedimiento de setup.

## Ejecutar

En terminales separadas:

```bash
pnpm --filter @42day/api dev
pnpm --filter @42day/dashboard dev
```

O usa:

```bash
bash scripts/bash/start-local-stack.sh
```

- API: `http://127.0.0.1:8787`
- Dashboard: `http://localhost:5173`

## Verificar

```bash
curl -fsS http://127.0.0.1:8787/health
pnpm typecheck
pnpm test
pnpm --filter @42day/dashboard build
```

Después ejecuta [Smoke tests](./smoke-tests.md). La configuración remota está en [Despliegue](./deployment.md).

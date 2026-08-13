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

## CLI headless local

La CLI headless solo acepta el Supabase local descrito por `supabase/config.toml`. Copia la plantilla,
completa la clave service role del stack local y no la versiones:

```bash
cp apps/api/.env.headless.local.example apps/api/.env.headless.local
pnpm --silent --filter @42day/api headless
```

Cada invocación recibe un único objeto JSON por stdin. `start`, `turn`, `inspect`, `reconcile` y
`close` escriben un único envelope JSON en stdout; los diagnósticos seguros van a stderr. El archivo
real se rechaza si falta `APP_ENV=local`, debug, el `project_id`, un endpoint loopback o los schemas
`control`/`tenant_template`. La sesión persiste en `apps/api/.headless-journal/` y `close` no borra los
datos tenant-locales. Cada sesión mantiene un lock durante todo el turno; turnos de sesiones distintas
pueden avanzar en paralelo. Si el proceso muere con un turno activo, el siguiente uso solo puede
continuar después de que el lock huérfano supere su umbral y ese turno queda `indeterminate`, sin replay
automático. La identidad reutilizada debe conservar tenant, proyecto local y origen `headless`.

Después de provisionar un tenant local, ejecuta `scripts/bash/sync-local-supabase-schemas.sh`. El helper
actualiza tanto `[api].schemas` como `authenticator.pgrst.db_schemas` mediante la función local existente,
para que PostgREST y la CLI compartan la misma lista de tenants expuestos.

Para validar o limpiar una corrida headless usa el helper cerrado por defecto:

```bash
scripts/bash/reset-local-headless-chat.sh --check
scripts/bash/reset-local-headless-chat.sh --reset --confirm local-headless-reset
```

`--check` solo valida `project_id=42day`, puertos loopback y los tenants sintéticos
`headless-demo`/`headless-isolation-b`. El segundo comando es deliberadamente destructivo para la base
local: ejecuta únicamente `supabase db reset --local` y mueve el journal exacto a un archivo recuperable.
Nunca debe ejecutarse con una URL remota. Después del reset, verifica el esquema con
`supabase db lint --local` y revisa los advisors disponibles en la versión instalada de Supabase.

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

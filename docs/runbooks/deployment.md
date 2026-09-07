# Despliegue y configuración externa

## Regla operativa

Un deploy no demuestra por sí solo que Meta, Supabase, Storage, Auth o el dashboard estén bien configurados. Registra ambiente, fecha y resultado de cada smoke test. Nunca copies tokens, project refs, phone IDs, WABA IDs, URLs firmadas ni IDs de cuenta a este documento.

## Preflight

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm --filter @42day/dashboard build
```

Confirma que las migraciones canónicas están aplicadas y que el tenant de prueba pasa las verificaciones de [onboarding](../architecture/tenant-onboarding.md).

## Supabase

1. Selecciona el proyecto del ambiente y verifica el enlace de CLI antes de aplicar cambios.
2. Aplica exclusivamente `supabase/migrations`.
3. Verifica `control`, `tenant_template` y tenants operativos.
4. Declara schemas expuestos y grants mínimos de Data API; comprueba RLS con los roles reales.
5. Verifica publication Realtime y buckets/policies de Storage cuando apliquen.
6. Ejecuta advisors después de cambios de schema o seguridad.

La exposición Data API de tablas nuevas es opt-in en proyectos actuales de Supabase. No dependas de privilegios automáticos.

## Secrets del Worker

Los ambientes soportados por `wrangler.toml` son `staging` y `production`. Carga cada secreto interactivamente:

## Enlaces QR/NFC (`go.thaledon.com`)

Antes de imprimir material físico, migra la zona autoritativa de `thaledon.com` a Cloudflare, asocia `go.thaledon.com` como Custom Domain del Worker y confirma que `DYNAMIC_LINK_BASE_URL` sea `https://go.thaledon.com`. No sustituir la ruta de perfiles `parahoy.thaledon.com/r/:tenantSlug`.

Después del despliegue, crea una unidad canario activa y valida durante 48 horas `GET` y `HEAD /r/<code>`: `302`, `Location` vigente, `Cache-Control: no-store, max-age=0`, `Pragma: no-cache` y `Referrer-Policy: no-referrer`. Solo después de esta evidencia se autoriza la impresión definitiva.

```bash
bash scripts/bash/set-cf-worker-secret.sh META_VERIFY_TOKEN --environment staging
bash scripts/bash/set-cf-worker-secret.sh META_ACCESS_TOKEN --environment staging
bash scripts/bash/set-cf-worker-secret.sh META_PHONE_NUMBER_ID --environment staging
bash scripts/bash/set-cf-worker-secret.sh META_WABA_ID --environment staging
bash scripts/bash/set-cf-worker-secret.sh SUPABASE_URL --environment staging
bash scripts/bash/set-cf-worker-secret.sh SUPABASE_ANON_KEY --environment staging
bash scripts/bash/set-cf-worker-secret.sh SUPABASE_SERVICE_ROLE_KEY --environment staging
bash scripts/bash/set-cf-worker-secret.sh GEMINI_API_KEY --environment staging
```

Añade solo los proveedores y capacidades utilizados por el ambiente. Para carga masiva, prepara localmente el archivo ignorado esperado por `scripts/bash/set-worker-secrets.sh`, primero ejecútalo con `--check` y nunca lo confirmes en Git.

## Worker

Autentica Wrangler y despliega:

```bash
pnpm --filter @42day/api exec wrangler login
bash scripts/bash/deploy-api.sh --environment staging
bash scripts/bash/test-api-health.sh --base-url <worker-url>
```

Para producción cambia explícitamente el ambiente y la URL. Revisa logs sin registrar contenido sensible:

```bash
bash scripts/bash/tail-worker-logs.sh --environment staging
```

## Meta

1. Configura producto WhatsApp, número y WABA del ambiente.
2. Usa `<worker-url>/webhooks/whatsapp` como callback.
3. Asegura coincidencia exacta de `META_VERIFY_TOKEN`.
4. Suscribe eventos de mensajes.
5. Registra `phone_number_id` en el canal del tenant correcto.
6. Ejecuta verify, inbound y outbound con un tester autorizado.

Los tokens temporales caducan; verifica vigencia en lugar de asumirla.

## Dashboard

Configura en el proveedor de hosting:

```text
VITE_API_BASE_URL=<worker-url>
VITE_SUPABASE_URL=<supabase-url>
VITE_SUPABASE_ANON_KEY=<supabase-public-key>
VITE_GOOGLE_MAPS_EMBED_API_KEY=<restricted-browser-key>
```

Añade el origen público del dashboard a `DASHBOARD_ALLOWED_ORIGINS`, despliega y prueba sesión, API autenticada y Realtime.

## Cierre

Ejecuta [Smoke tests](./smoke-tests.md) para los módulos contratados. Documenta fuera del repositorio: ambiente, commit, fecha, responsable y evidencia; no documentes secretos ni afirmes que otro ambiente comparte el resultado.

# Dashboard y páginas públicas de ParaHoy

Aplicación React/Vite para la operación de restaurantes, la administración de la plataforma y la experiencia pública de Presencia Digital. El nombre técnico del paquete continúa siendo `@42day/dashboard`.

## Experiencias actuales

- Restaurante: pedidos, filtros, detalle, transcripción, pausa/reanudación, agotados, reemplazos, progreso de cocina y notificaciones.
- Configuración: menú, catálogo, cobertura, pagos, perfil público y conocimiento del concierge.
- Plataforma: restaurantes, miembros y analytics internos.
- Público: perfil del restaurante, carta, recomendaciones, concierge y páginas informativas/legales.

## Límites actuales

- No existe una bandeja humana completa ni compositor de respuestas.
- La landing pública y su autogestión todavía son parciales.
- `App.tsx` y algunas vistas de pedidos siguen concentrando demasiadas responsabilidades.
- El bundle principal requiere seguimiento de tamaño.

## Acceso a datos

- Las operaciones de negocio pasan por `apps/api` usando `VITE_API_BASE_URL`.
- Supabase directo se limita a Auth y suscripciones Realtime autorizadas.
- `VITE_SUPABASE_ANON_KEY` es pública por definición; la seguridad depende también de grants mínimos y RLS. Nunca se expone `SUPABASE_SERVICE_ROLE_KEY`.

## Desarrollo

```bash
pnpm --filter @42day/dashboard dev
pnpm --filter @42day/dashboard typecheck
pnpm --filter @42day/dashboard test
pnpm --filter @42day/dashboard build
```

Variables:

```text
VITE_API_BASE_URL
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Consulta [Arquitectura del frontend](../../docs/architecture/dashboard-frontend.md) y [Estado actual](../../docs/current-status.md).

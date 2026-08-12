# Arquitectura del monorepo

## Objetivo

El monorepo permite evolucionar ParaHoy Pedidos y ParaHoy Presencia Digital sobre contratos compartidos, sin mezclar transporte, reglas de negocio y presentación.

```text
apps/
  api/          Cloudflare Worker, WhatsApp y API
  dashboard/    dashboard y páginas públicas
packages/
  config/       validación de configuración
  core/         reglas puras compartidas
  db/           utilidades de datos; migraciones internas legacy
  prompts/      carga y composición de prompts
  t-router/     abstracción de proveedores IA
  types/        contratos compartidos
supabase/
  migrations/   historial canónico de base de datos
docs/           decisiones durables y procedimientos
```

## Dependencias

- Las rutas traducen HTTP y delegan.
- Los features poseen casos de uso, dominio y adaptadores de su capacidad.
- `core` y `types` no dependen de aplicaciones.
- El dominio no importa Hono, React, Supabase ni proveedores concretos.
- La API puede depender de paquetes; el dashboard depende de contratos, no de implementación backend.
- Supabase se accede mediante adaptadores y migraciones canónicas.

## Convenciones

- Un contrato compartido tiene un solo dueño en `packages/types`.
- Una regla pura reutilizable vive en `packages/core`.
- Los prompts son versionados y sus salidas estructuradas se validan en runtime.
- La lógica nueva se agrega al feature dueño; las fachadas heredadas solo reexportan mientras se completa una migración.
- Errores externos se traducen en errores de aplicación observables sin filtrar secretos.

## Pruebas y Definition of Done

- Preferir pruebas de dominio puras y tests de integración con adapters falsos.
- No depender de red, reloj o azar reales salvo suites marcadas como integración/E2E.
- Los hotfixes sobre código heredado agregan primero una prueba de caracterización cuando resulte razonable.
- Un cambio termina con typecheck, tests relevantes y build de las aplicaciones afectadas.
- Un cambio de base de datos sigue [Migraciones multi-tenant](./database-migrations.md).
- Un cambio de comportamiento actualiza [Estado actual](../current-status.md) y evita crear un plan histórico permanente.

```bash
pnpm typecheck
pnpm test
pnpm build
```

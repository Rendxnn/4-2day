# Arquitectura de ParaHoy

> Entrada canónica a la arquitectura. Las estructuras detalladas y los procedimientos operativos
> permanecen en los documentos enlazados. Un plan puede evolucionar esta arquitectura únicamente
> mediante una decisión explícita y aprobada, y debe actualizar la documentación durable al terminar.

## Fronteras del sistema

```text
Meta WhatsApp Cloud API
  -> apps/api: transporte, orquestación y API de negocio autorizada
     -> casos de uso y adaptadores de features
        -> packages/core: reglas puras reutilizables de dominio
        -> packages/types: contratos compartidos
        -> packages/prompts y packages/t-router: límite de prompts/proveedores IA
        -> Supabase: Postgres, Auth, Storage, Realtime y Data API

apps/dashboard
  -> operación autenticada mediante apps/api
  -> Supabase directo solo para Auth y Realtime controlado
  -> perfil público, carta y concierge
```

## Reglas de responsabilidad

| Área | Es dueña de | No debe ser dueña de |
| --- | --- | --- |
| `apps/api` | Transporte HTTP/WhatsApp, orquestación, autorización y adaptadores | Reglas puras reutilizables escondidas en rutas |
| `apps/dashboard` | Dashboard y UI pública, estado cliente e integración API | Acceso privilegiado o cálculos autoritativos de negocio |
| `packages/core` | Reglas puras y transiciones de dominio | Hono, React, Supabase, Meta o proveedores IA |
| `packages/types` | Contratos compartidos de requests, responses, eventos y dominio | Orquestación o comportamiento de proveedores |
| `packages/prompts` | Carga y composición versionada de prompts | Mutaciones de base de datos o verdad de negocio |
| `packages/t-router` | Abstracción de proveedores IA | Autoridad sobre pedidos o persistencia específica |
| `supabase/migrations` | Evolución canónica, grants, RLS y funciones multi-tenant | Comportamiento que no sea una invariante de datos |

La lógica nueva vive en el feature dueño de la capacidad. Las fachadas históricas pueden reexportar
durante una migración, pero NO DEBEN recibir nuevo comportamiento de negocio.

## Invariantes obligatorias

- Resolución de tenant, autorización, grants y RLS preservan aislamiento en cada frontera de datos.
- El backend posee precios, totales, cobertura, disponibilidad, transiciones y persistencia
  autoritativos.
- Todo evento entrante sujeto a reintentos se procesa idempotentemente.
- Los fallos externos son observables, no filtran secretos y no dejan mutaciones parciales.
- ParaHoy Pedidos sigue `texto + estado actual + contexto permitido -> IA -> acción controlada ->
  validación y ejecución determinista`.
- ParaHoy Presencia Digital puede explicar y recomendar productos, pero no confirma pedidos.
- Los entitlements comerciales se mantienen separados del estado operativo y las pausas.

## Requisitos de todo plan

Un plan no trivial contiene:

- evidencia del comportamiento actual con archivos y símbolos reales;
- fronteras afectadas y cambios de responsabilidad;
- árbol objetivo de archivos añadidos, modificados, movidos y eliminados;
- efectos en contratos, APIs, eventos, prompts y modelo de datos;
- análisis de tenant, autorización, idempotencia, concurrencia y fallos cuando aplique;
- alternativas descartadas y por qué el diseño elegido es la opción segura más simple;
- estrategia de rollout, compatibilidad, observabilidad y rollback;
- matriz de trazabilidad requisito-prueba.

## Fuentes detalladas

- [Monorepo](./docs/architecture/monorepo.md)
- [Backend](./docs/architecture/backend.md)
- [Frontend del dashboard](./docs/architecture/dashboard-frontend.md)
- [Migraciones de base de datos](./docs/architecture/database-migrations.md)
- [Onboarding de tenants](./docs/architecture/tenant-onboarding.md)
- [Flujo conversacional](./docs/flows/conversation-flow.md)
- [Presencia Digital](./docs/flows/presence-digital.md)

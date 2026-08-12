# ParaHoy

ParaHoy es una plataforma modular para restaurantes:

- **ParaHoy Pedidos:** automatización y operación de pedidos por WhatsApp.
- **ParaHoy Presencia Digital:** landing básica, carta pública y concierge IA.
- **Paquete completo:** catálogo compartido y continuidad del carrito web en WhatsApp.

El repositorio conserva identificadores técnicos históricos como `42day` y `@42day`; la marca de producto es ParaHoy.

## Estado

Los dos módulos tienen caminos funcionales y se ofrecen mediante onboarding acompañado. Persisten brechas antes de considerarlos autoservicio o listos para escala. Consulta:

- [Contexto canónico del producto](./PROJECT_CONTEXT.md)
- [Estado actual, desalineaciones y prioridades](./docs/current-status.md)

## Desarrollo local

Requisitos: Node.js 22+, pnpm 9.15.0 y credenciales locales de los servicios usados.

```bash
pnpm install
pnpm --filter @42day/api dev
pnpm --filter @42day/dashboard dev
```

- Dashboard: `http://localhost:5173`
- API: `http://127.0.0.1:8787`

Validaciones principales:

```bash
pnpm typecheck
pnpm test
pnpm --filter @42day/dashboard build
```

La preparación completa de variables, Supabase y Meta está en [Setup local](./docs/runbooks/local-setup.md).

## Estructura

```text
apps/
  api/          Worker, webhooks y API de dashboard
  dashboard/    operación interna y páginas públicas
packages/       contratos y utilidades compartidas
supabase/       migraciones canónicas
docs/           arquitectura, flujos, integraciones y runbooks
```

## Documentación

- [Arquitectura](./docs/architecture/monorepo.md)
- [Flujo de pedidos](./docs/flows/conversation-flow.md)
- [Presencia Digital](./docs/flows/presence-digital.md)
- [Despliegue](./docs/runbooks/deployment.md)
- [Smoke tests](./docs/runbooks/smoke-tests.md)

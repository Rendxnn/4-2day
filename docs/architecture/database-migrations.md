# Migraciones multi-tenant

## Fuentes canónicas

- `supabase/migrations`: historial ejecutable y único lugar para migraciones nuevas.
- `control`: registro global de tenants, canales, miembros y capacidades administrativas.
- `tenant_template`: baseline estructural para tenants futuros.
- `tenant_demo`: sandbox funcional, nunca plantilla.
- `tenant_<slug>`: instancia operativa de cada restaurante.

`packages/db/migrations` y sus seeds son referencia histórica; no reciben cambios nuevos ni se usan para provisionar ambientes.

## Regla de cambio tenant

Una capacidad nueva debe cubrir en la misma entrega:

1. estructura futura en `tenant_template`;
2. rollout idempotente a cada `tenant_*` existente;
3. hooks o funciones necesarios para que el provisionamiento futuro instale tablas, RPC, políticas y publicaciones;
4. grants mínimos y RLS de todo objeto expuesto;
5. verificación de drift y comportamiento.

No se modifica `tenant_demo` como fuente y luego se copia manualmente. Los tenants nuevos se crean desde la plantilla vigente mediante `control.provision_restaurant_tenant`.

## Data API, grants y RLS

Desde 2026 Supabase migra hacia exposición opt-in de tablas nuevas. Crear una tabla y habilitar RLS no garantiza por sí solo acceso mediante Data API.

Para todo objeto requerido por API, dashboard o Realtime se debe verificar por separado:

- que el schema esté incluido explícitamente en los schemas expuestos de Data API;
- que `anon`, `authenticated` o `service_role` tengan solo los `GRANT` necesarios;
- que RLS esté habilitado y sus policies expresen autorización real;
- que las tablas Realtime estén en la publication correspondiente.

Los grants controlan acceso al objeto; RLS controla filas después de obtener ese acceso. Nunca se expone una tabla sin ambas capas cuando el rol cliente puede alcanzarla. `SUPABASE_SERVICE_ROLE_KEY` permanece solo en backend.

El repositorio incluye `control.refresh_postgrest_tenant_schemas()`, pero el alta de un tenant no debe darse por completa sin confirmar exposición y grants efectivos. La automatización de esa verificación es una brecha vigente.

## Flujo de desarrollo

1. Comprobar versión y ayuda de Supabase CLI: `supabase --version` y `supabase migration --help`.
2. Crear el archivo mediante `supabase migration new <nombre>`.
3. Implementar baseline, rollout y provisionamiento futuro de forma idempotente.
4. Probar en un proyecto local o efímero, no en producción como primer destino.
5. Ejecutar advisors y revisar seguridad cuando haya funciones, vistas, RLS o Storage.
6. Aplicar la migración completa sobre una base vacía y sobre una copia con tenants existentes.
7. Verificar `supabase migration list --local` y el smoke test funcional.

## Checklist

- [ ] `tenant_template` representa el estado futuro.
- [ ] Todos los tenants existentes recibieron el rollout.
- [ ] El provisionamiento futuro instala la capacidad.
- [ ] Schemas expuestos y grants son explícitos y mínimos.
- [ ] RLS y policies están verificadas con los roles reales.
- [ ] Realtime y Storage se verificaron si aplican.
- [ ] La migración es repetible y no depende de SQL manual fuera del historial.
- [ ] Se actualizó documentación solo si cambió una regla o procedimiento durable.

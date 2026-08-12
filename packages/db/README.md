# DB

Paquete técnico de utilidades y clientes de datos.

La fuente canónica de migraciones es `supabase/migrations`. `packages/db/migrations` y `packages/db/seeds` son archivos históricos anteriores al workflow Supabase CLI: no reciben migraciones nuevas, no se ejecutan para provisionar ambientes y no prueban el estado de una base remota.

El modelo vigente usa `control`, `tenant_template`, `tenant_demo` y schemas `tenant_<slug>`. Consulta [Migraciones multi-tenant](../../docs/architecture/database-migrations.md).

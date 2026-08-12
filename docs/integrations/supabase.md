# Integración con Supabase

## Responsabilidades

- Postgres para datos globales y schemas por restaurante.
- Auth para sesiones y miembros del dashboard.
- Storage para imágenes, archivos de conocimiento y comprobantes.
- Realtime para actualizaciones operativas autorizadas.
- Data API/PostgREST como adaptador HTTP desde el Worker y para las excepciones frontend definidas.

## Credenciales

- `SUPABASE_ANON_KEY`: clave pública usada con Auth/RLS; no concede autorización por sí sola.
- `SUPABASE_SERVICE_ROLE_KEY`: secreto server-side con privilegios elevados; nunca se usa en el dashboard ni en variables `VITE_*`.
- `SUPABASE_URL`: URL del proyecto correspondiente al ambiente.

## Acceso

El dashboard usa `apps/api` para datos y mutaciones de negocio. El acceso directo a Supabase se limita a Auth y suscripciones Realtime deliberadas. El Worker usa credenciales server-side y aun así aplica autorización de aplicación y aislamiento de tenant.

## Schemas

- `control`: datos globales, tenants, canales, membresías y administración.
- `tenant_template`: plantilla canónica.
- `tenant_demo`: sandbox.
- `tenant_<slug>`: datos operativos de un restaurante.

Consulta [Migraciones multi-tenant](../architecture/database-migrations.md) para baseline y rollout.

## Data API y RLS

La exposición del schema, los grants y RLS son controles distintos:

1. el schema debe estar entre los schemas expuestos;
2. el rol necesita `USAGE` y privilegios mínimos sobre el objeto;
3. RLS y sus policies determinan qué filas puede operar;
4. Realtime requiere además publication cuando corresponda.

Supabase ya no garantiza que nuevas tablas queden expuestas automáticamente. El onboarding debe declarar grants explícitos y verificar acceso efectivo. No se corrigen permisos concediendo acceso amplio ni añadiendo `SECURITY DEFINER` sin revisar autorización y `EXECUTE`.

## Storage

Los buckets y políticas deben diferenciar contenido público y privado. Los comprobantes de pago son privados y se acceden mediante backend o URLs firmadas de corta duración. Las imágenes destinadas a carta/perfil pueden ser públicas si la política del producto lo requiere.

Una subida con reemplazo necesita permisos compatibles con insert, select y update. Cada flujo debe probarse con el rol real, no solo con `service_role`.

## Operación segura

- Aplicar migraciones únicamente desde `supabase/migrations`.
- Confirmar CLI con `supabase --version` y descubrir comandos con `--help`.
- Ejecutar advisors después de cambios de schema/seguridad.
- Verificar RLS, grants, vistas, funciones y Storage con roles mínimos.
- No registrar tokens, claves o URLs firmadas en documentación ni logs.
- Fechar cualquier afirmación sobre un proyecto remoto; el repositorio no demuestra su estado actual.

Referencias oficiales: [seguridad de Data API](https://supabase.com/docs/guides/api/securing-your-api) y [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

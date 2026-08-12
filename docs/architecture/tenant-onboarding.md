# Onboarding de restaurantes

## Alcance actual

El onboarding es acompañado. La consola administrativa crea restaurante, sede inicial y miembros, pero el equipo debe verificar infraestructura y configuración externa antes de declarar activo un tenant.

## Secuencia

1. Definir módulos contratados; hasta que existan entitlements separados, registrar esta decisión fuera de `automation_enabled` y no prometer enforcement técnico.
2. Crear el tenant desde la consola admin, que invoca el provisionamiento server-side.
3. Confirmar registro en `control`, schema `tenant_<slug>`, sede y defaults.
4. Verificar que el schema provenga de `tenant_template` y tenga las extensiones tenant-locales vigentes.
5. Configurar explícitamente exposición Data API, grants mínimos, RLS y Realtime. No asumir exposición automática de tablas nuevas.
6. Crear usuario/membresía y probar autorización real de `encargado` o `trabajador`.
7. Configurar catálogo, carta, cobertura, pagos y Presencia Digital según el paquete.
8. Para ParaHoy Pedidos, registrar canal Meta y confirmar que `phone_number_id` resuelva al tenant correcto.
9. Ejecutar [Smoke tests](../runbooks/smoke-tests.md) y fechar la evidencia externa.

## Separación de conceptos

- **Entitlement:** módulo comprado; modelo técnico pendiente.
- **Estado del tenant:** activo, inactivo o suspendido.
- **Automatización operativa:** `automation_enabled` a nivel tenant/sede.
- **Pausa conversacional:** control temporal de una conversación individual.

Ninguno de los tres últimos sustituye al entitlement.

## Seguridad

- `SUPABASE_SERVICE_ROLE_KEY` solo se usa en API y scripts confiables.
- Cada tabla expuesta necesita grants mínimos y RLS con autorización real.
- Las funciones privilegiadas se revocan de `PUBLIC` y se conceden solo al rol requerido.
- Los dominios, URLs, IDs de Meta y estado de deploy se documentan con placeholders; los valores reales viven en gestores de secretos o consolas externas.

## Criterio de finalización

Un tenant está listo cuando los módulos contratados pasan sus smoke tests, el acceso de un usuario real está autorizado, los canales apuntan al tenant correcto y las verificaciones externas tienen fecha. La mera creación del schema no completa el onboarding.

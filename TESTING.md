# Estrategia de pruebas de ParaHoy

## Propósito

Las pruebas son evidencia ejecutable de que la implementación satisface el feature aprobado. Todo
requisito funcional y regresión debe mapearse a una prueba o a una verificación manual/externa
aprobada explícitamente cuando automatizarla no sea viable.

## Clases de prueba

| Clase | Propósito | Ubicación típica |
| --- | --- | --- |
| Unitaria/dominio | Reglas puras, validación, estados y cálculos | Paquete dueño o `apps/*/test` |
| Integración | Casos de uso con adapters, persistencia, rutas, prompts y fakes | `apps/api/test` |
| UI | Comportamiento público y del dashboard observable por un usuario | `apps/dashboard/test` |
| Caracterización | Preservar comportamiento legacy antes de refactorizar | Suites `*.test.mjs` existentes |
| E2E/smoke | Validar despliegues y configuración externa | `docs/runbooks/smoke-tests.md` |

Una prueba que lee archivos fuente o busca fragmentos de código es caracterización estructural. PUEDE
proteger una migración, pero NO DEBE ser la única evidencia de un requisito de comportamiento.

## Trazabilidad de requisitos

El SPEC posee requisitos numerados y escenarios de aceptación. El plan mapea cada requisito a:

- nivel y archivo previsto de prueba;
- camino exitoso, límites relevantes y fallos;
- fakes o fixtures necesarios;
- evidencia manual/externa y revisor responsable si no es automatizable.

Las tareas ubican las pruebas dentro de la fase que posee el comportamiento. Para una regresión, crea
o identifica la prueba de comportamiento fallida antes de modificar la implementación cuando sea
razonablemente posible.

## Determinismo y aislamiento

- Las pruebas unitarias y de integración normales no dependen de red real, reloj, azar, credenciales
  productivas ni estado compartido entre tenants.
- El comportamiento de proveedores IA se prueba con fixtures estructurados o fakes controlados. Solo
  evaluaciones separadas y nombradas llaman un modelo real cuando el SPEC lo exige.
- Supabase, Meta, Cloudflare y servicios desplegados se verifican como integración/E2E, con datos no
  productivos y registro de ambiente, fecha y resultado.
- Fixtures y logs no contienen secretos ni datos de clientes no aprobados.

## Comandos canónicos

Durante la implementación, ejecuta primero la suite más acotada del workspace afectado:

```bash
pnpm --filter @42day/api test
pnpm --filter @42day/dashboard test
pnpm --filter <workspace-afectado> typecheck
pnpm --filter <workspace-afectado> build
```

Antes de declarar completo un feature funcional, ejecuta desde la raíz:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Si un comando no aplica o está bloqueado por una dependencia externa, el plan debe explicar por qué y
definir evidencia sustituta. Un check omitido o bloqueado nunca se reporta como exitoso.

## Evidencia de finalización

Un feature está completo en pruebas solo cuando:

- cada requisito y escenario de aceptación tiene evidencia;
- las nuevas pruebas de regresión fallan frente al defecto, o se justifican como caracterización
  cuando producir un fallo previo no sea seguro;
- pasan los comandos focalizados y los obligatorios de repositorio;
- las verificaciones externas o manuales requeridas tienen resultados fechados;
- fallos, flakes y pruebas omitidas se resolvieron o fueron aceptados explícitamente;
- `quickstart.md` y los runbooks durables coinciden con el camino verificado.

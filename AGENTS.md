# Instrucciones para agentes de ParaHoy

## Contexto obligatorio

Antes de modificar este repositorio, lee las fuentes aplicables a la tarea:

1. `PROJECT_CONTEXT.md`: alcance del producto y estado deseado.
2. `docs/current-status.md`: estado implementado y brechas verificadas.
3. `.specify/memory/constitution.md`: gobierno de ingeniería no negociable.
4. `ARCHITECTURE.md` y los documentos detallados que enlaza.
5. `CODESTYLE.md`: estándar de TypeScript, módulos, efectos y frontend.
6. `TESTING.md`: evidencia y comandos de verificación obligatorios.
7. Los artefactos del feature activo bajo `specs/<feature>/`, cuando existan.

Un `AGENTS.md` más cercano PUEDE añadir instrucciones específicas del área, pero NO DEBE debilitar
la constitución raíz ni las reglas de tenant, seguridad, pruebas y especificación.

La documentación de producto, arquitectura y los artefactos de Spec Kit se escriben en español. El
código, los identificadores y los comentarios técnicos necesarios se escriben en inglés.

## Flujo obligatorio de Spec Kit

Todo cambio de comportamiento, contratos, datos, dependencias, arquitectura, flujos operativos o
pruebas DEBE estar respaldado por un feature aprobado de Spec Kit. No modifiques código primero para
documentarlo después.

1. `$speckit-specify`: define qué y por qué, evidencia actual, comportamiento deseado, alcance,
   exclusiones, escenarios de aceptación, casos límite y requisitos numerados.
2. `$speckit-clarify`: resuelve ambigüedades críticas. Las decisiones de producto requieren aprobación
   del usuario.
3. `$speckit-plan`: define diseño técnico, estructura futura de archivos, responsabilidades,
   contratos, impacto de datos, riesgos, rollout y mapeo requisito-prueba.
4. `$speckit-checklist`: genera la revisión de calidad de requisitos. El agente implementador NO DEBE
   autoaprobar los ítems que pertenecen al revisor.
5. `$speckit-tasks`: crea fases ordenadas por dependencias con pruebas, implementación, documentación,
   verificación y checkpoints de commit.
6. `$speckit-analyze`: resuelve inconsistencias bloqueantes en el artefacto que las origina antes de
   escribir código.
7. `$speckit-implement`: implementa una fase acotada a la vez cuando el trabajo no sea trivial y
   verifícala antes de continuar.
8. `$speckit-converge`: compara el código con los artefactos aprobados; implementa las tareas añadidas
   y repite hasta converger.

Las correcciones puras de ortografía y el mantenimiento factual de documentación PUEDEN omitir un
feature solo cuando no cambien requisitos, comportamiento, arquitectura, contratos, pruebas ni
procedimientos operativos.

## Reglas de implementación

- Preserva los cambios del usuario y excluye trabajo no relacionado con el feature activo.
- **Prohibición de producción:** NUNCA publiques, despliegues, promociones ni asocies un cambio a producción (incluidos dashboard, Worker, DNS, secretos, migraciones o proveedores externos) salvo que el usuario lo autorice explícitamente en el mensaje actual. La autorización para implementar, verificar, commitear o desplegar staging no autoriza producción. Antes de cualquier acción de producción, confirma el objetivo, el ambiente y el cambio exacto; si falta cualquiera de ellos, detente y pide autorización.
- Usa `pnpm` y los scripts existentes. No añadas dependencias de producción sin documentarlas y
  aprobarlas en el plan.
- Respeta `CODESTYLE.md`. Si una regla amplía materialmente el alcance, registra la deuda y la
  condición de retiro en el plan en lugar de ocultarla o hacer una refactorización incidental.
- Mantén reglas de negocio en el feature dueño o en un paquete puro compartido; rutas y UI delegan.
- Usa `supabase/migrations` como única fuente para migraciones nuevas.
- Nunca expongas secretos, credenciales privilegiadas, datos de tenants ni URLs firmadas.
- Todo texto de cliente en ParaHoy Pedidos pasa por IA con estado actual y contexto permitido. Solo el
  backend validado ejecuta una acción controlada y modifica estado.
- Si la implementación descubre un cambio de producto o arquitectura, detén ese camino y actualiza
  SPEC, plan y tareas antes de continuar.
- Una fase significativa completa y verificada termina en un Conventional Commit enfocado cuando la
  tarea autorice implementación. No hagas commit de fases incompletas o con fallos.

## Verificación y finalización

- Añade pruebas de comportamiento para cada requisito funcional y regresión.
- Las pruebas que inspeccionan source PUEDEN preservar estructura legacy, pero no sustituyen evidencia
  de comportamiento.
- Ejecuta pruebas focalizadas durante cada fase y los comandos exigidos por `TESTING.md` antes de
  terminar.
- Reporta checks bloqueados u omitidos; nunca los presentes como exitosos.
- Actualiza `docs/current-status.md` y la documentación durable cuando cambie el comportamiento.
- No declares completado mientras queden tareas, fallen verificaciones, la documentación contradiga
  el código o Spec Kit no haya convergido.

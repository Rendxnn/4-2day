<!--
Sync Impact Report
- Version change: template (unratified) -> 1.0.0
- Modified principles:
  - Placeholder Principle 1 -> I. Especificación antes de implementación
  - Placeholder Principle 2 -> II. Arquitectura y responsabilidades antes del código
  - Placeholder Principle 3 -> III. Pruebas de comportamiento y trazabilidad
  - Placeholder Principle 4 -> IV. Entrega por fases verificadas
  - Placeholder Principle 5 -> V. Invariantes de producto e IA controlada
- Added sections:
  - Restricciones de producto y técnicas
  - Flujo de desarrollo y gates de calidad
- Removed sections: none
- Follow-up TODOs: none
-->
# Constitución de ParaHoy

## Core Principles

### I. Especificación antes de implementación
Todo cambio funcional DEBE tener un feature SPEC aprobado antes de modificar código de aplicación. El
SPEC DEBE definir problema, objetivo, evidencia actual, comportamiento deseado, alcance, exclusiones,
requisitos numerados, escenarios de aceptación, casos límite, fallos, supuestos y preguntas abiertas.
Las ambigüedades críticas DEBEN resolverse antes de planear y un agente NO DEBE elegir silenciosamente
comportamiento que cambie materialmente el alcance. Así, la intención se revisa antes de que un detalle
de implementación se convierta en requisito accidental.

### II. Arquitectura y responsabilidades antes del código
Todo plan DEBE describir la arquitectura resultante antes de implementar. DEBE identificar fronteras,
contratos, datos, dependencias, estructura esperada de archivos o componentes y dueño de cada nueva
responsabilidad. El dominio DEBE permanecer independiente de Hono, React, Supabase, Meta y proveedores
IA; las aplicaciones PUEDEN depender de paquetes compartidos, pero estos NO DEBEN depender de las
aplicaciones. Toda abstracción, dependencia o acceso entre capas nuevo DEBE justificar por qué una
alternativa más simple no basta.

### III. Pruebas de comportamiento y trazabilidad
Todo requisito funcional DEBE mapearse a escenarios de aceptación y pruebas ejecutables, o a una
verificación manual/externa documentada cuando automatizar no sea viable. Las pruebas DEBEN verificar
comportamiento observable y fallos relevantes. Leer source o buscar fragmentos PUEDE caracterizar
estructura legacy, pero NO DEBE ser la única evidencia de comportamiento. Una regresión DEBE añadir
primero una prueba fallida o caracterización justificada cuando sea razonable. Red, reloj y azar reales
DEBEN sustituirse por dobles salvo en suites explícitas de integración o E2E.

### IV. Entrega por fases verificadas
Las tareas DEBEN ordenarse por dependencias y agruparse en fases verificables. Una fase solo termina
cuando sus tareas, pruebas relevantes, typecheck, builds afectados y documentación pasan y están
alineados. Cada fase significativa completa DEBE conservarse en un Conventional Commit enfocado; no
se mezcla trabajo no relacionado. Si un descubrimiento cambia el comportamiento deseado, primero
DEBE actualizarse el SPEC y después el plan y las tareas. La implementación DEBE continuar mediante
convergencia de Spec Kit hasta que no quede trabajo requerido.

### V. Invariantes de producto e IA controlada
La implementación DEBE preservar invariantes de ParaHoy, aislamiento tenant, autorización,
idempotencia y validación server-side. En ParaHoy Pedidos, todo texto del cliente DEBE ser interpretado
por IA con estado actual y contexto permitido. La IA DEBE devolver únicamente una acción controlada
permitida para el estado; NO DEBE escribir en base de datos, calcular precios autoritativos, decidir
disponibilidad final ni inventar identificadores canónicos. El backend DEBE validar esquema, evidencia,
permisos, reglas, concurrencia y transición antes de mutar. Una salida inválida, ambigua, obsoleta o
incompatible DEBE conservar el estado anterior y seguir el camino seguro de aclaración o error. El
procesamiento determinista permanece obligatorio para infraestructura, seguridad y ejecución, pero NO
DEBE evitar la IA al interpretar texto del cliente.

## Restricciones de producto y técnicas

- `PROJECT_CONTEXT.md` es la autoridad de propósito, alcance y estado deseado.
- `docs/current-status.md` es la autoridad de capacidades actuales, parciales, experimentales y
  deseadas. Toda afirmación sobre servicios externos DEBE tener verificación fechada.
- Los documentos bajo `docs/architecture/` definen las fronteras vigentes hasta implementar un plan
  aprobado que las sustituya y actualizar la documentación durable.
- ParaHoy Pedidos y ParaHoy Presencia Digital son módulos comerciales independientes con catálogo y
  configuración compartidos. Flags operativos y pausas NO DEBEN usarse como entitlements.
- `packages/types` posee contratos; `packages/core`, reglas puras; los features, casos de uso y
  adapters; las rutas traducen transporte y delegan.
- El acceso a datos de negocio DEBE pasar por fronteras backend autorizadas. Supabase directo desde el
  frontend se limita a Auth y Realtime aprobados.
- Todo cambio de base de datos DEBE usar `supabase/migrations`, preservar aislamiento tenant y definir
  grants, RLS y rollout multi-tenant deliberadamente.
- Secretos, credenciales, IDs sensibles, URLs firmadas y datos no aprobados de clientes NO DEBEN
  aparecer en SPEC, planes, tareas, pruebas, logs, fixtures ni documentación.
- La documentación y los artefactos Spec Kit se escriben en español; código, identificadores y
  comentarios técnicos necesarios se escriben en inglés.

## Flujo de desarrollo y gates de calidad

1. Inspeccionar source, pruebas, contexto, estado actual y arquitectura relevantes antes de afirmar
   comportamiento actual.
2. Ejecutar `$speckit-specify` para producir un SPEC enfocado en qué y por qué.
3. Ejecutar `$speckit-clarify` hasta eliminar ambigüedades críticas. El agente implementador NO DEBE
   autoaprobar decisiones de producto.
4. Ejecutar `$speckit-plan` con arquitectura, árbol futuro, contratos, datos, rollout, riesgos y
   estrategia requisito-prueba.
5. Ejecutar `$speckit-checklist`; un revisor humano DEBE aprobar la calidad de requisitos.
6. Ejecutar `$speckit-tasks`; pruebas y verificación viven en la fase dueña del comportamiento, junto
   con documentación y checkpoint de commit.
7. Ejecutar `$speckit-analyze` y corregir inconsistencias bloqueantes en su fuente antes de programar.
8. Ejecutar `$speckit-implement` una fase acotada a la vez para trabajo no trivial. Verificar pruebas,
   typecheck y build afectados antes de cada commit.
9. Antes de terminar, `pnpm test`, `pnpm typecheck` y `pnpm build` DEBEN pasar salvo que el SPEC
   aprobado documente que un comando no aplica o está bloqueado. Un bloqueo NO DEBE reportarse como
   éxito.
10. Ejecutar `$speckit-converge`; si añade tareas, repetir implementación y verificación hasta
    converger y actualizar la documentación durable cuando cambie comportamiento.

Un feature está listo para implementar solo con SPEC y plan aprobados, checklist sin pendientes,
tareas accionables, requisitos mapeados a verificación y análisis sin hallazgos bloqueantes. Está
terminado solo cuando pasan tareas y verificaciones, la documentación refleja la realidad, los commits
son revisables y converge no encuentra brechas.

## Governance

Esta constitución gobierna SPEC, planes, tareas, código y revisiones de ParaHoy. Ante conflicto con
otro documento de proceso, prevalece esta constitución; la verdad de producto sigue en
`PROJECT_CONTEXT.md` y la de implementación en `docs/current-status.md` y el código verificado.

Toda enmienda DEBE ser explícita, aprobada por el responsable de producto, registrada en el Sync
Impact Report y propagada a la guía afectada. Las versiones siguen SemVer: MAJOR para eliminar o
redefinir principios de forma incompatible, MINOR para principios nuevos u obligaciones ampliadas y
PATCH para aclaraciones no semánticas. La fecha de ratificación permanece fija y Last Amended cambia
con contenido normativo.

Toda revisión de SPEC, plan y pull request DEBE comprobar las reglas aplicables. Una excepción aprobada
DEBE ser limitada, temporal, justificada en el plan y tener dueño y condición de retiro. Conveniencia,
presión de tiempo, autonomía del agente o un patrón legacy no son excepciones suficientes.

**Version**: 1.0.0 | **Ratified**: 2026-08-12 | **Last Amended**: 2026-08-12

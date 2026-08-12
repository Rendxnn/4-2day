# Estándar de código de ParaHoy

> **Estado: activo.** Este documento es el estándar canónico para código nuevo y código modificado.
> La deuda existente se corrige mediante features aprobados; no justifica reescrituras masivas ni
> cambios de formato mezclados con comportamiento.

## Objetivos

El código de ParaHoy debe ser:

- correcto en sus tipos y explícito en sus estados;
- legible sin depender de comentarios que repitan la implementación;
- fácil de probar de forma aislada;
- seguro en fronteras externas, multi-tenant y de IA;
- consistente entre aplicaciones y paquetes;
- sencillo de modificar sin conocer todo el monorepo.

Las palabras **DEBE**, **NO DEBE**, **DEBERÍA** y **PUEDE** expresan obligación, prohibición,
recomendación y opción, respectivamente.

## Formato y lenguaje

- Código, identificadores, nombres de archivos técnicos y comentarios DEBEN escribirse en inglés.
- Copy del producto y contenido mostrado al usuario PUEDEN estar en español o inglés según la capa de
  internacionalización; no se traducen identificadores para reflejar ese copy.
- Los archivos DEBEN usar UTF-8, finales de línea LF, indentación de dos espacios y una línea final.
- TypeScript y TSX DEBEN usar comillas dobles, punto y coma y trailing commas donde el lenguaje lo
  permita.
- La longitud objetivo es 100 caracteres. Una línea PUEDE excederla cuando dividir URLs, copy, tipos
  generados o clases utilitarias perjudique más la lectura; JSX complejo DEBERÍA extraerse antes de
  aceptar líneas extensas.
- El formatter futuro será la autoridad sobre decisiones puramente mecánicas. No se discute ni se
  ajusta manualmente código solo para contradecir su salida.
- Un cambio funcional NO DEBE incluir formateo masivo o renombres no relacionados.

## Nombres y archivos

| Elemento | Convención | Ejemplo |
| --- | --- | --- |
| Variables y funciones | `camelCase` | `resolveTenantContext` |
| Tipos, clases y componentes | `PascalCase` | `ControlledOrderAction` |
| Constantes verdaderamente globales | `UPPER_SNAKE_CASE` | `MAX_HISTORY_ITEMS` |
| Booleanos | prefijo `is`, `has`, `can`, `should` o `was` | `isAutomationPaused` |
| Archivos TypeScript no visuales | `kebab-case.ts` | `customer-status.ts` |
| Componentes React | `PascalCase.tsx` | `OrderMetaCard.tsx` |
| Tests | nombre del comportamiento o unidad + `.test.mjs` mientras se conserve el runner actual | `order-status.test.mjs` |
| Migraciones | timestamp y descripción `snake_case` | `20260812090000_add_entitlements.sql` |

- Los nombres DEBEN expresar intención de dominio. Se evitan `data`, `item`, `value`, `handler`,
  `manager` o `utils` cuando existe un nombre más preciso.
- Las funciones que producen efectos usan verbos explícitos: `send`, `persist`, `publish`, `delete`.
  Las funciones puras usan verbos como `calculate`, `derive`, `map`, `parse`, `validate` o `resolve`.
- Un archivo `helpers.ts` o `utils.ts` solo es válido si su responsabilidad está acotada al feature y
  el nombre más específico no aporta claridad.
- No se crean variantes duplicadas como `service.ts`, `service-new.ts` o `service-v2.ts`. Una transición
  temporal se describe en el plan y termina eliminando o convirtiendo la fachada anterior.

## Módulos, imports y exports

- Cada archivo DEBERÍA tener una responsabilidad principal y pertenecer al feature dueño del
  comportamiento descrito en `ARCHITECTURE.md`.
- Rutas HTTP, handlers de webhook y componentes de página DEBEN delegar reglas de negocio a casos de
  uso, servicios o funciones puras del feature.
- Código nuevo NO DEBE añadirse a fachadas legacy de `apps/api/src/modules` cuando ya exista un dueño
  bajo `apps/api/src/features`. Una fachada temporal solo reexporta y debe tener una condición de
  retiro documentada.
- Las dependencias entre workspaces usan el nombre del paquete. Dentro de un feature se usan imports
  relativos; una cadena profunda de `../../../` es una señal para revisar la frontera, no para crear
  un alias arbitrario.
- Los imports se agrupan en este orden, separados únicamente cuando mejore la lectura:
  1. plataforma y dependencias externas;
  2. paquetes del workspace;
  3. módulos internos;
  4. imports exclusivamente de tipos mediante `import type`.
- Los imports relativos de source se escriben sin extensión `.ts` o `.tsx`, salvo una necesidad de
  runtime documentada. El repositorio NO DEBE mezclar ambas formas dentro de la misma frontera.
- Se prefieren exports nombrados. `export default` se reserva para integraciones que lo exijan, como
  el entrypoint del Worker o configuración de tooling.
- Los barrel files solo definen la API pública de un paquete o sostienen una migración temporal. No se
  usan para ocultar dependencias circulares ni para exponer internals de un feature.

## Diseño de TypeScript

### Tipos y fronteras

- `strict`, `noUncheckedIndexedAccess` y `noImplicitOverride` DEBEN permanecer habilitados.
- `any` está prohibido. Una frontera no confiable entra como `unknown` y se valida antes de usarla.
- JSON, webhooks, variables de entorno, respuestas HTTP, respuestas de IA, almacenamiento y filas de
  base de datos DEBEN tratarse como fronteras no confiables.
- Un `as T` NO valida datos. En fronteras externas se usa un schema, type guard o parser que produzca
  un resultado tipado y un error controlado.
- Una non-null assertion (`!`) solo PUEDE aparecer inmediatamente después de una comprobación que
  TypeScript no logra estrechar. Se prefiere guardar el valor comprobado en una variable local.
- Los estados y acciones se modelan como uniones discriminadas. No se representan combinaciones
  inválidas mediante múltiples booleanos opcionales.
- Se prefieren `type` para datos, aliases, unions y composición. `interface` se reserva para contratos
  extensibles o implementables, como adapters de proveedores.
- Se prefieren arrays `as const` más un tipo derivado sobre `enum`, a menos que una integración
  externa requiera semántica de enum en runtime.
- `satisfies` se prefiere sobre una aserción cuando se quiere comprobar una estructura sin ampliar
  sus literales.
- Los tipos públicos y contratos compartidos viven en `packages/types`; tipos internos, filas de
  persistencia y detalles de proveedores permanecen junto a su implementación.
- Las funciones exportadas DEBEN declarar tipo de retorno cuando este forme parte de un contrato o
  cuando la inferencia oculte una unión importante. Las funciones locales simples PUEDEN inferirlo.

### Datos y dominio

- Los valores monetarios autoritativos usan enteros en la unidad definida por el dominio; no usan
  floats para cálculos de precio.
- Fechas intercambiadas entre fronteras usan ISO 8601 y zona horaria explícita. La fecha de negocio
  del restaurante se resuelve en una función dueña, no mediante la zona horaria implícita del host.
- Los IDs opacos permanecen como strings y nunca se interpretan por su contenido.
- Los objetos de entrada con más de tres parámetros conceptuales DEBERÍAN usar un objeto nombrado.
- No se mutan argumentos ni estructuras compartidas salvo que el contrato y el nombre lo hagan
  explícito. Las transformaciones de dominio se prefieren puras.
- Una regla crítica de negocio tiene un único dueño. UI, rutas y repositorios no duplican cálculos de
  precio, disponibilidad, cobertura ni transiciones.

## Funciones y control de flujo

- Una función hace una operación conceptual. Si mezcla validación, acceso externo, transformación y
  presentación, DEBERÍA separarse por responsabilidades.
- Se prefieren guard clauses y retornos tempranos sobre anidamiento profundo.
- Una función que supera aproximadamente 50 líneas o un archivo que supera 300 líneas requiere
  revisar si contiene más de una responsabilidad. Estos son umbrales de diseño, no razones para
  fragmentar mecánicamente código cohesivo.
- No se usan argumentos booleanos cuya intención sea ambigua. Se usan opciones nombradas o funciones
  diferentes.
- Los `switch` sobre uniones de dominio DEBERÍAN ser exhaustivos. Añadir un estado debe causar un
  error de tipos o una prueba fallida en cada consumidor relevante.
- Toda promesa se espera, retorna o maneja explícitamente. No se dejan promesas flotantes.
- Operaciones independientes PUEDEN ejecutarse en paralelo; operaciones con orden, transacciones o
  efectos dependientes DEBEN permanecer secuenciales.

## Errores, observabilidad y efectos

- Se lanzan errores tipados para fallos que el caller pueda distinguir y manejar. No se compara el
  texto de un error para gobernar lógica cuando existe un código estable.
- `catch` recibe `unknown`. Antes de leer propiedades se estrecha el error o se pasa por un
  normalizador seguro.
- Un error no se ignora silenciosamente. Los fallbacks permitidos deben estar documentados, ser
  observables y conservar invariantes.
- Código de aplicación NO usa `console.*` directamente. Usa el logger estructurado y sus funciones de
  sanitización. La implementación interna del logger es la excepción.
- Logs incluyen identificadores técnicos y resultado, no texto de clientes, secretos, tokens,
  direcciones, cuerpos completos de proveedores ni URLs firmadas.
- Los efectos externos tienen timeout o cancelación cuando la plataforma lo permita, errores
  clasificables y una política explícita de reintento o no reintento.
- Todo evento reintentable y toda mutación sensible define idempotencia. Operaciones relacionadas se
  ejecutan atómicamente o implementan compensación segura.

## Fronteras HTTP, persistencia e IA

- Una ruta valida autenticación, tenant, parámetros y body antes de invocar comportamiento de
  negocio. La respuesta expone un contrato estable y no una fila de base de datos accidental.
- Los repositorios son dueños de queries y mapeo de filas. No son dueños de decisiones de producto.
- Toda consulta y mutación tenant-aware recibe o deriva un tenant validado; ninguna función lo toma
  de input controlado por el cliente sin autorización.
- Cambios de esquema se realizan únicamente mediante `supabase/migrations`, con RLS, grants,
  compatibilidad de rollout y rollback considerados en el plan.
- Todo output estructurado de IA se valida contra un schema y contra el estado vigente antes de
  ejecutarse. Texto generado nunca posee autoridad sobre precios, permisos, disponibilidad o
  transiciones.
- En ParaHoy Pedidos, el modelo propone exclusivamente acciones controladas. El servidor conserva el
  estado anterior ante acciones inválidas y decide aclaración, error o handoff de forma explícita.
- Prompts y schemas reutilizables pertenecen a su paquete o feature dueño; no se incrustan copias
  divergentes en rutas.

## React y frontend

- Se usan componentes funcionales nombrados y hooks en el nivel superior.
- Estado derivable de props u otro estado se calcula; no se duplica en `useState` ni se sincroniza
  mediante `useEffect` sin necesidad.
- `useEffect` se reserva para sincronización con sistemas externos. Sus dependencias deben ser
  completas y sus suscripciones deben limpiarse.
- El estado se mantiene lo más cerca posible de su consumidor. Solo se eleva o comparte cuando dos o
  más ramas necesitan la misma fuente de verdad.
- Componentes de página coordinan; componentes de feature presentan una responsabilidad. Reglas
  autoritativas de pedidos, pagos o permisos no viven en React.
- Requests, respuestas y errores pasan por una capa cliente tipada. No se dispersa `fetch` por los
  componentes.
- Listas usan keys estables del dominio. No se usa el índice cuando los elementos pueden reordenarse,
  agregarse o eliminarse.
- Formularios y controles deben funcionar con teclado, tener label accesible y exponer estados de
  carga, vacío, error y éxito cuando apliquen.
- Copy repetido, contenido bilingüe y metadata deben centralizarse; un componente no debe crecer por
  contener grandes catálogos de texto mezclados con layout.

## Comentarios y documentación en código

- Un comentario explica por qué existe una decisión, invariante, workaround o restricción externa;
  no narra qué hace la siguiente línea.
- Workarounds temporales indican condición de retiro y, cuando exista, referencia al SPEC o issue.
- `TODO` sin responsable, condición verificable o referencia está prohibido.
- JSDoc se usa para APIs públicas, contratos no obvios y precondiciones importantes; no es obligatorio
  para símbolos internos cuyo nombre y tipo ya son suficientes.
- No se conserva código comentado. Git es el historial.

## Pruebas y capacidad de cambio

- Código nuevo se diseña para permitir dependencias inyectables en fronteras de red, reloj, azar y
  proveedores externos.
- Cada requisito funcional y regresión tiene una prueba de comportamiento conforme a `TESTING.md`.
- Las pruebas usan Arrange–Act–Assert de forma legible, un motivo principal de fallo y nombres que
  describen comportamiento observable.
- No se añaden métodos o exports únicamente para facilitar una prueba si se puede probar a través del
  contrato real.
- Fixtures son pequeños, explícitos y no contienen secretos ni datos reales de clientes.

## Revisión y adopción incremental

Antes de aprobar código, el revisor comprueba:

1. ubicación y responsabilidad correctas;
2. estados inválidos difíciles de representar;
3. validación de todas las fronteras no confiables;
4. errores, tenant, idempotencia y logs seguros;
5. trazabilidad con requisitos y pruebas;
6. ausencia de duplicación, compatibilidad temporal sin retiro o cambios ajenos al feature;
7. nombres, imports, formato y comentarios consistentes con este documento.

Las reglas aplican inmediatamente a archivos nuevos. En archivos legacy modificados, la fase debe
corregir el área tocada cuando sea seguro y acotado. Si cumplir una regla amplía materialmente el
scope, el plan registra la deuda y una condición de retiro; no se oculta mediante disables globales.
Una excepción local necesita motivo, alcance mínimo y eliminación explícita.

## Decisiones vigentes y automatización pendiente

- La longitud objetivo es 100 caracteres, con las excepciones justificadas descritas arriba.
- Los archivos no visuales usan `kebab-case.ts` y los componentes React, `PascalCase.tsx`.
- Los imports relativos dentro de source omiten la extensión; los tests `.mjs` PUEDEN importar `.ts`
  explícitamente por necesidad del runtime actual.
- Los umbrales de 50 líneas por función y 300 por archivo disparan una revisión de responsabilidad,
  pero no son límites mecánicos.
- Los tests `.test.mjs` permanecen válidos mientras se conserve el runner actual. Una migración a
  TypeScript requiere un feature separado y no se mezcla con cambios funcionales.
- La selección e instalación de Biome o ESLint + Prettier queda pendiente para la fase de enforcement.
  Hasta entonces, revisión humana y de agente aplican las reglas que TypeScript no puede comprobar.

**Version**: 1.0.0 | **Ratified**: 2026-08-12 | **Last Amended**: 2026-08-12

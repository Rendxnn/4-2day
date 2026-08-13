# Contrato de paridad con WhatsApp

## Definición

Para igual tenant base, catálogo, configuración, estado inicial, texto normalizado, reloj controlado y respuesta cruda de IA, WhatsApp y headless deben producir la misma **proyección canónica observable**, salvo diferencias explícitamente permitidas de transporte.

La prueba no compara filas completas ni IDs aleatorios. Compara valores funcionales después de canonicalizar IDs a aliases por orden de aparición y tiempos a relaciones (`active`, `expired`, transición), no a timestamps absolutos.

## Campos comparados

| Área | Campos canónicos |
| --- | --- |
| Respuesta | orden, tipo, texto/caption completo persistido y cantidad de mensajes |
| Conversación | estado, automatización, razón de handoff y condición de expiración |
| Borrador | estado, cantidad/identidad semántica de líneas, cantidades, opciones resueltas, fulfillment, pago, subtotal, fee y total |
| Pedido | creado/no creado, estado, totales y referencia al borrador canónico |
| Routing | rama final, reason code, IA intentada/usada, outcome y tipos de operaciones validadas |
| Efectos | tipo, cantidad, orden lógico y resultado (`created`, `updated`, `captured`, `skipped`, `failed`) |
| Alertas | tipo y estado, sin contenido libre |

## Diferencias permitidas

| WhatsApp | Headless | Motivo |
| --- | --- | --- |
| `source/provider=whatsapp_cloud` | `source/provider=headless` | Identidad del adaptador. |
| Meta provider message ID | Sin ID Meta o ID local opaco | Headless no contacta Meta. |
| Entrega `sent`/`failed` | Entrega `captured` | Observable propio del transporte. |
| Firma/webhook event | Claim/journal local | Idempotencia de adaptador. |
| Latencias externas | Latencias locales | No son resultado de negocio. |

Ninguna otra diferencia está permitida. En particular, no se permiten diferencias en parser de IA, validación, selección de acción, mutación, estado conversacional, totales, handoff ni contenido que recibiría el cliente.

La comparación de paridad lee internamente la captura completa tenant-local de ambos adaptadores. La
redacción de `stdout`, journal e `inspect` es un contrato de exposición separado: se valida contra la
misma respuesta completa, pero suprimir dirección, billing u otros valores sensibles no cuenta como
diferencia conversacional. El harness nunca imprime la captura completa al reportar un diff.

## Matriz mínima

| ID | Estado/entrada | Observable clave |
| --- | --- | --- |
| P-01 | Saludo o solicitud de menú | Misma herramienta seleccionada por IA y respuesta validada. |
| P-02 | Consulta de estado de pedido | Misma herramienta seleccionada por IA y estado backend reportado. |
| P-03 | Solicitud explícita de humano | Misma herramienta IA, transición a manual y alerta. |
| P-04 | Adición semántica de producto válido | Misma línea, cantidades y totales. |
| P-05 | IA inventa ID de producto | Misma invalidación; cero mutación no autorizada. |
| P-06 | Selección de método de pago | Misma herramienta IA, campo de borrador y siguiente paso. |
| P-07 | Producto configurable con opción | Misma herramienta IA, opción backend validada y precio. |
| P-08 | Confirmación de pedido | Exactamente un pedido y misma transición. |
| P-09 | Confianza baja | Misma aclaración, sin ejecutar operación. |
| P-10 | Tercer intento fallido de aclaración | Mismo handoff/automatización. |
| P-11 | Respuesta inválida del proveedor primario y secundaria válida | Mismo fallback y resultado. |
| P-12 | Todos los proveedores no disponibles | Misma respuesta segura y cero corrupción. |
| P-13 | Conversación en manual/automatización desactivada | Mismo inbound persistido y cero intento IA/respuesta. |
| P-14 | Reactivación manual con último inbound pendiente | Mismo claim único e interpretación IA; origen WhatsApp usa el fake Meta y origen headless persiste `captured`, visible por `inspect` y sin reescribir el resultado previo. |
| P-15 | Dirección sensible y geocodificación no disponible | Misma respuesta completa interna, clasificación, conservación de estado y siguiente paso; la proyección pública headless redacta dirección/billing y declara códigos estables. |

## Procedimiento de comparación

1. Preparar dos tenants equivalentes en Supabase local o restaurar el mismo seed antes de cada variante; se permite `supabase db reset` sobre el stack local validado.
2. Fijar reloj e IDs solo para la prueba; no permitir control desde CLI real.
3. Alimentar la misma respuesta cruda de IA registrada a ambos adaptadores.
4. Capturar Meta con un fake en la variante WhatsApp y persistencia headless completa en la otra.
5. Comparar dentro del harness la respuesta completa y el snapshot canónico, canonicalizando aliases;
   cualquier mensaje de fallo debe usar únicamente digests/códigos seguros.
6. Eliminar exclusivamente los campos listados como diferencias permitidas.
7. Exigir igualdad profunda del resto.
8. Validar por separado la proyección pública redactada y sus `redactionCodes` contra el schema v1.
9. Ejecutar además la variante headless con un espía que falla si se intenta `graph.facebook.com`.

Una prueba que solo inspecciona que ambos archivos importan el mismo router no satisface paridad.

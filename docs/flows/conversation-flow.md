# Flujo conversacional de ParaHoy Pedidos

## Regla principal

Todo mensaje de texto del cliente se envía a IA junto con el estado vigente y el contexto permitido. El modelo devuelve acciones controladas; el backend las valida y ejecuta. No se usan coincidencias textuales locales para decidir intención antes del modelo.

Audio se transcribe y su texto entra al mismo contrato. Ubicación, imágenes, documentos y eventos del webhook se normalizan determinísticamente porque no son interpretación de texto.

## Ciclo

1. Meta entrega el evento y el webhook valida, normaliza e identifica el mensaje.
2. El backend resuelve tenant, cliente y conversación; un mensaje repetido no se procesa dos veces.
3. Se carga estado, draft, menú vigente, opciones, disponibilidad y contexto necesario.
4. La IA recibe texto y `allowedOperations` calculadas para el estado.
5. La salida estructurada se valida contra esquema, IDs, evidencia y transición permitida.
6. El backend aplica la acción, recalcula hechos y persiste de forma consistente.
7. Se compone una respuesta basada en el resultado real, se registra y se envía.

La misma secuencia posterior a la normalización puede ejecutarse desde la CLI local headless. En ese
caso el texto sigue entrando al plan semántico y las respuestas usan una entrega `captured`, sin
solicitudes a Meta. La pausa manual conserva el inbound y evita IA; al reactivar se reclama únicamente
el último inbound headless pendiente y se procesa una vez con captura `manual_resume`.

Si ninguna acción es segura, el pedido no cambia. El cliente recibe una aclaración o la conversación pasa a intervención humana según el error.

## Acciones conceptuales

- Mostrar menú o solicitar ayuda humana.
- Agregar, quitar o cambiar cantidad/notas/configuración de una línea.
- Elegir domicilio/recogida, dirección y medio de pago.
- Registrar, cambiar o reutilizar datos de facturación.
- Continuar checkout, confirmar, editar o cancelar cuando el estado lo permita.

La lista concreta permanece tipada en código. Este documento define el principio y no sustituye el contrato runtime.

## Pedido y checkout

### Selección

El cliente puede escribir de forma natural. La IA refiere únicamente IDs del menú y líneas recibidos en contexto. Configuraciones obligatorias se completan antes de avanzar; cantidades, precios y disponibilidad se recalculan en backend.

### Fulfillment y dirección

- Recogida avanza sin dirección de entrega.
- Domicilio acepta ubicación de WhatsApp o dirección escrita.
- El backend geocodifica cuando corresponde y valida cobertura; una dirección no resoluble no avanza silenciosamente.

### Billing y pago

El cliente puede usar factura normal o electrónica y reutilizar perfiles guardados. Los medios actuales son efectivo y transferencia. La transferencia solicita comprobante después de la revisión operativa que corresponda y permanece sujeta a revisión humana.

### Confirmación

El resumen se deriva del draft persistido. Solo una confirmación válida para `awaiting_confirmation` crea la orden. Toda orden inicia pendiente de revisión del restaurante.

### Operación del restaurante

El restaurante puede aceptar, marcar agotados, proponer reemplazos y actualizar progreso. Los cambios relevantes producen notificaciones y mantienen historial. Los comprobantes no se concilian automáticamente.

## Handoff humano

Solicitudes de asesor, fallas semánticas/operativas y casos no resolubles generan alertas y pueden pausar la conversación en `manual`. La pausa guarda un estado de reanudación y bloquea respuestas automáticas posteriores.

Estado actual: existen alertas, transcripción y controles de pausa/reanudación. Falta una bandeja dedicada, timeline independiente, compositor humano y acciones completas desde las alertas.

Reanudar no aprueba pagos ni cierra revisiones pendientes. Solo restaura la automatización conversacional compatible.

## Estados vigentes

### Conversación

`new`, `awaiting_mode_selection`, `awaiting_guided_item_selection`, `awaiting_product_configuration`, `awaiting_more_items`, `awaiting_fulfillment_type`, `awaiting_address`, `awaiting_billing_reuse_confirmation`, `awaiting_normal_billing_info`, `awaiting_electronic_billing_info`, `awaiting_payment_method`, `awaiting_transfer_proof`, `awaiting_transfer_fallback_payment_method`, `awaiting_confirmation`, `awaiting_restaurant_confirmation`, `awaiting_order_adjustment`, `manual`, `completed`, `expired`.

### Draft

`draft`, `needs_clarification`, `ready_for_confirmation`, `confirmed`, `cancelled`, `expired`.

### Orden

`new`, `pending_restaurant_confirmation`, `needs_customer_replacement`, `payment_pending_review`, `accepted`, `preparing`, `on_the_way`, `delivered`, `cancelled`.

## Desalineación pendiente

El router actual todavía contiene bypass deterministas para algunas entradas y respuestas exactas. Deben retirarse y reemplazarse por pruebas que verifiquen:

- toda entrada textual intenta interpretación IA;
- la IA solo devuelve acciones permitidas por el estado;
- una acción inválida no muta draft, orden ni conversación;
- reintentos y acciones obsoletas no duplican efectos;
- fallas de proveedores producen aclaración o handoff observable.

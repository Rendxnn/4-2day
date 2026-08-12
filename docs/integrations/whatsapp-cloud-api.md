# Integración con WhatsApp Cloud API

## Frontera

Meta entrega eventos al endpoint `/webhooks/whatsapp`. El Worker verifica el challenge, normaliza mensajes, resuelve el tenant por `phone_number_id`, persiste inbound y envía respuestas mediante Graph API.

## Variables

```text
META_VERIFY_TOKEN
META_ACCESS_TOKEN
META_PHONE_NUMBER_ID
META_WABA_ID
META_GRAPH_API_VERSION
```

`META_WABA_ID` es el nombre canónico. Tokens y IDs reales se guardan en secrets del ambiente, no en Git ni en ejemplos documentales.

## Reglas

- Validar `hub.verify_token` durante la suscripción.
- Deduplicar mensajes por ID porque Meta reintenta webhooks.
- Responder HTTP sin bloquear innecesariamente el webhook.
- Registrar errores sin contenido sensible.
- Transcribir audio y enviar el texto resultante al mismo flujo IA.
- Tratar ubicación, imágenes y documentos según su tipo antes de entrar a negocio.
- Todo texto del cliente se interpreta mediante IA; Meta no cambia esa regla.

## Alta de un canal

1. Preparar número, WABA y aplicación en Meta.
2. Cargar secrets en el Worker del ambiente.
3. Registrar el canal y `phone_number_id` en `control` para el tenant correcto.
4. Configurar callback `<worker-url>/webhooks/whatsapp` y suscribir mensajes.
5. Ejecutar verificación y un flujo inbound/outbound real.
6. Fechar el resultado; no asumir que un token temporal o tester continúa vigente.

El número demo es válido para desarrollo acompañado. La preparación de números productivos, plantillas, calidad y límites de mensajería se verifica en Meta para cada cliente.

Consulta [Despliegue](../runbooks/deployment.md) y [Smoke tests](../runbooks/smoke-tests.md).

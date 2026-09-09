# Research: Configuración rápida móvil de QR

## Decisión 1: escaneo compatible mediante adapter cargado bajo demanda

**Decision**: Usar `@zxing/browser` para decodificar exclusivamente QR desde un stream de cámara, encapsulado en `DynamicLinkQrScanner` y cargado cuando se abre el flujo.

**Rationale**: La API `BarcodeDetector` sigue marcada como disponibilidad limitada y requiere contexto seguro; no debe ser la única base de compatibilidad. ZXing ofrece explícitamente lectura desde `<video>` y webcam. La carga diferida evita aumentar el bundle inicial de todo el dashboard. Fuentes: [MDN BarcodeDetector](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector/detect) y [ZXing browser](https://github.com/zxing-js/browser).

**Alternatives considered**:

- Solo `BarcodeDetector`: menor dependencia, pero cobertura inconsistente, especialmente para Safari/iOS.
- Usar la cámara nativa del teléfono fuera del dashboard: abre el redirect y pierde el contexto administrativo.
- Web NFC: no resuelve el QR, tiene compatibilidad limitada y no pertenece al alcance.

## Decisión 2: entrada manual como camino equivalente

**Decision**: Aceptar tanto la URL canónica completa como el código de 12 caracteres; el parser devuelve el código o un error estable. La UI nunca navega al valor escaneado.

**Rationale**: Permite operar ante permiso denegado, cámara incompatible, daño de impresión o mala luz, sin ampliar la superficie a URLs arbitrarias.

**Alternatives considered**:

- Aceptar cualquier URL que contenga `/r/`: podría confundir códigos de otros dominios.
- Buscar el texto escaneado dentro de las 200 unidades cargadas: falla al crecer el inventario y depende de filtros locales.

## Decisión 3: clasificación automática de destino

**Decision**: Derivar `google_review`, `whatsapp` e `instagram` por hosts oficiales; derivar `menu` solo cuando el host coincida con el origen público configurado de ParaHoy y el pathname sea `/carta` o comience por `/carta/`; clasificar el resto de HTTPS público como `website`. El backend es autoritativo.

**Rationale**: Quita un campo del camino frecuente sin relajar `validateDynamicLinkDestination`. Una URL de menú externa sigue funcionando como `website`; puede reclasificarse luego en el editor detallado porque el tipo no altera la redirección.

**Alternatives considered**:

- Pedir el tipo siempre: conserva taxonomía perfecta, pero añade fricción a cada unidad.
- Inferir cualquier URL con palabras como `menu`: propenso a clasificaciones falsas.

## Decisión 4: una sola RPC existente

**Decision**: Crear un endpoint rápido que llame una vez a `control.update_dynamic_link_unit` con etiqueta, tipo, destino y estado activo.

**Rationale**: La función existente ya bloquea la fila, valida revisión, actualiza e inserta auditoría en una transacción breve. Reutilizarla evita una migración, nuevos grants y riesgo de divergencia.

**Alternatives considered**:

- Encadenar `PATCH` y `POST /activate`: puede quedar parcialmente aplicado si la segunda solicitud falla.
- Añadir una RPC específica: duplica una operación que la RPC genérica ya expresa de forma segura.

## Decisión 5: asociación de negocio opcional

**Decision**: Mostrar un selector opcional. Al no modificarlo, conserva la asociación existente; “Sin asignar” elimina negocio y sede; al elegir un negocio se reutiliza su sede predeterminada, igual que el editor completo.

**Rationale**: Mantiene la regla de QR no asociado sin impedir asignar un hablador durante una visita. El CRUD detallado sigue siendo el lugar para administrar lotes e hitos físicos.

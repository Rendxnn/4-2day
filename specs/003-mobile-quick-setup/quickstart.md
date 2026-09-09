# Quickstart de validación: Configuración rápida móvil

## Prerequisites

- Usuario de prueba con `system_admin`.
- Dashboard y Worker desplegados en staging con HTTPS.
- Tres unidades: `available`, `active` y `archived`.
- Un QR físico de la unidad disponible y un QR externo.
- Un iPhone/Safari y un Android/Chrome acordados para el piloto.

## Automated checks

```bash
pnpm --filter @42day/core test
pnpm --filter @42day/api test
pnpm --filter @42day/dashboard test
pnpm --filter @42day/core typecheck
pnpm --filter @42day/api typecheck
pnpm --filter @42day/dashboard typecheck
pnpm test
pnpm typecheck
pnpm build
```

## Evidencia de implementación — 2026-09-09

- Pasaron `apps/api/test/dynamic-links.test.mjs` (8 pruebas, incluidas referencia canónica, seguridad de destino, autorización, lookup exacto, activación atómica, archivado y conflicto de revisión).
- Pasaron `apps/dashboard/test/dynamic-link-quick-setup.test.mjs` (2 caracterizaciones de acceso, fallback, cámara y flujo NFC) y los typechecks directos de `packages/types`, API y dashboard.
- Pasó `apps/dashboard/node_modules/.bin/vite build`; el lector ZXing quedó en un chunk cargado bajo demanda. Vite solo informó los warnings de tamaño ya existentes (>500 kB).
- El gate raíz Turbo no pudo completarse: Corepack rechazó ejecutar el `pnpm@9.15.0` fijado porque no pudo verificar su firma desde el registry. No se ignoró esa protección. La discrepancia corresponde a `ENG-012`; los checks focalizados directos anteriores sí pasaron.
- Pendientes de evidencia externa: atomicidad/auditoría/RLS sobre Supabase real y la matriz manual iPhone/Safari + Android/Chrome de este documento.

## Regresión de lectura — 2026-09-09

- Se comprobó la lectura de código directo, URL HTTPS canónica, QR propio sin esquema, barra final y carácter invisible final. Un host externo o una referencia sin host propio siguen rechazándose antes del lookup.
- La pantalla conserva la lectura en el campo manual y separa QR inválido, unidad inexistente y error de API/red para que el operador pueda recuperar el flujo sin adivinar la causa.

## Scenario A: camera happy path

1. Abrir QR/NFC en un teléfono y tocar “Configuración rápida”.
2. Conceder cámara y escanear el QR disponible.
3. Comprobar que código y URL coinciden con la impresión.
4. Escribir una etiqueta, pegar un HTTPS permitido y guardar/activar.
5. Abrir la URL en otra pestaña y comprobar redirect al destino nuevo.
6. Comprobar auditoría, revisión incrementada y asociación todavía vacía.

Expected: operación completa menor a 60 s, lectura menor a 3 s y ninguna mutación parcial.

## Scenario B: no camera/manual recovery

1. Denegar el permiso de cámara.
2. Pegar la URL canónica de la unidad activa.
3. Cambiar destino y guardar.
4. Repetir con QR externo y código inexistente.

Expected: la entrada manual funciona; QR externo no navega; el destino activo cambia conservando URL y asociación.

## Scenario C: concurrency and archive

1. Resolver la misma unidad en dos sesiones.
2. Guardar en la primera y luego intentar guardar en la segunda.
3. Escanear la unidad archivada.

Expected: la segunda recibe conflicto y conserva su borrador; archivada no ofrece guardar.

## Scenario D: NFC copy

1. Completar una configuración y tocar “Copiar enlace para NFC”.
2. Pegar el clipboard en el programador NFC y comparar carácter por carácter con QR/resultado.
3. Denegar clipboard, repetir y copiar manualmente desde el campo visible.
4. Tocar “Escanear otro”.

Expected: URL idéntica, feedback claro y sesión reiniciada sin datos anteriores.

## Camera cleanup

Durante scanning, cerrar el diálogo, cambiar de pestaña y completar una lectura en intentos separados. En todos los casos, el indicador del sistema operativo debe mostrar que la cámara dejó de usarse.

Registrar dispositivo, sistema, navegador, fecha, 20 intentos, lecturas exitosas al primer intento y tiempos aproximados en la evidencia del PR.

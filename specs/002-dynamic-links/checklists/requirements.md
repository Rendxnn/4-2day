# Checklist de calidad — enlaces dinámicos

**Propósito:** revisión independiente de claridad y cobertura del requisito antes de entrega.

## Seguridad y ciclo de vida

- [ ] CHK001 ¿Están definidos para cada estado los códigos HTTP y la información que no se revela? [Claridad, FR-004]
- [ ] CHK002 ¿Están especificadas las transiciones permitidas y la irreversibilidad de archivado? [Cobertura, FR-012]
- [ ] CHK003 ¿La política de validación de destinos distingue de forma consistente los tipos admitidos? [Consistencia, FR-009]

## Operación física

- [ ] CHK004 ¿Los requisitos de impresión y la evidencia de lectura están cuantificados? [Medibilidad, NFR-004]
- [ ] CHK005 ¿El flujo de NFC documenta la correspondencia verificable entre URL, QR, UID y bloqueo? [Cobertura, US3]

## Integración y despliegue

- [ ] CHK006 ¿La dependencia DNS/Cloudflare y el criterio de canario se describen de forma verificable? [Cobertura, SC-004]
- [ ] CHK007 ¿La exclusión de analítica y autoservicio evita requisitos contradictorios para el MVP? [Consistencia, FR-014]

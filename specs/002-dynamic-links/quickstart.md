# Validación rápida

1. Aplicar la migración de Supabase y configurar variables del Worker, incluido `DYNAMIC_LINK_BASE_URL`.
2. Iniciar API/dashboard según `TESTING.md`; como `system_admin`, crear una unidad y asignar URL HTTPS válida.
3. Activar la unidad y abrir `https://go.thaledon.com/r/<code>`: debe devolver 302, `Cache-Control: no-store`, `Pragma: no-cache` y `Referrer-Policy: no-referrer`.
4. Cambiar el destino y repetir: debe ir al nuevo URL de inmediato.
5. Suspender/archivar y confirmar 403/410 sin revelar destino; intentar reactivar archivada y confirmar 409.
6. Descargar QR SVG, imprimirlo a 25×25 mm y validar 30 lecturas en tres dispositivos. Programar el mismo URL como NDEF URI en NTAG215, registrar UID e hitos, verificar y bloquear el tag.

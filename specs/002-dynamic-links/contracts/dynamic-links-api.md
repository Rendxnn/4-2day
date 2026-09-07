# Contrato HTTP — Dynamic Links

## Público

`GET|HEAD /r/:code`

- Activa y válida: `302 Location: <destination>` y `Cache-Control: no-store, max-age=0`, `Pragma: no-cache`, `Referrer-Policy: no-referrer`.
- Disponible: `200` HTML genérico.
- Suspendida: `403` HTML genérico.
- Archivada: `410` HTML genérico.
- Desconocida/malformada: `404` HTML genérico.
- Dependencia no disponible: `503` HTML genérico.

## Administración (Bearer + system_admin)

| Método/ruta | Entrada | Resultado |
| --- | --- | --- |
| `GET /dashboard/admin/dynamic-links` | filtros `query,status,tenantId,batchId,limit,offset` | unidades paginadas |
| `POST /dashboard/admin/dynamic-links` | `requestId,label` | unidad + URL canónica |
| `POST /dashboard/admin/dynamic-links/batches` | `requestId,label,count<=500` | lote + unidades |
| `PATCH /dashboard/admin/dynamic-links/:id` | `revision`, campos editables | unidad actualizada o 409 |
| `POST /dashboard/admin/dynamic-links/:id/:action` | `revision` y datos de hito | unidad actualizada |
| `GET /dashboard/admin/dynamic-links/:id/audit` | — | historial append-only |
| `GET /dashboard/admin/dynamic-links/export` | filtros | CSV para inventario/manifiesto |

Las mutaciones devuelven `400` ante formato/destino inválido, `401/403` ante auth, `404` inexistente y `409` ante revisión obsoleta o transición prohibida.

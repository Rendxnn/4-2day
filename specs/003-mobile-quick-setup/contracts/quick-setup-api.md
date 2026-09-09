# Contract: API de configuración rápida

Todas las rutas viven bajo `/dashboard`, requieren bearer token válido y `app_metadata.system_admin === true`.

## Resolver unidad por código

`GET /admin/dynamic-links/by-code/:code`

### Path

- `code`: código público normalizado a mayúsculas; debe cumplir el formato canónico.

### Success `200`

```json
{
  "unit": {
    "id": "uuid",
    "publicCode": "0123456789AB",
    "publicUrl": "https://go.thaledon.com/r/0123456789AB",
    "label": "Mesa piloto",
    "status": "available",
    "revision": 3
  }
}
```

La respuesta usa el contrato completo `DynamicLinkUnit`; asociación y destino pueden estar ausentes.

### Errors

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `dynamic_link_code_invalid` | El path no es un código canónico |
| 401 | contrato auth existente | Sesión ausente/inválida |
| 403 | contrato auth existente | No es administrador global |
| 404 | `dynamic_link_not_found` | No existe unidad con ese código |
| 502 | `dynamic_link_storage_failed` | Dependencia de datos no disponible |

## Configurar y activar atómicamente

`PATCH /admin/dynamic-links/:id/quick-configuration`

### Request

```json
{
  "revision": 3,
  "label": "Café Central - mostrador",
  "destinationUrl": "https://g.page/r/example/review",
  "tenantId": "uuid-opcional"
}
```

`tenantId` omitido conserva la asociación actual; `null` elimina negocio/sede; un UUID válido asigna ese negocio y su sede predeterminada. No acepta `locationId`, UID ni hitos de fabricación.

### Success `200`

```json
{
  "unit": {
    "id": "uuid",
    "publicCode": "0123456789AB",
    "publicUrl": "https://go.thaledon.com/r/0123456789AB",
    "label": "Café Central - mostrador",
    "destinationType": "google_review",
    "destinationUrl": "https://g.page/r/example/review",
    "status": "active",
    "revision": 4
  }
}
```

### Errors

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `dynamic_link_revision_invalid` | Revisión ausente o inválida |
| 400 | `dynamic_link_label_invalid` | Etiqueta vacía o mayor a 160 |
| 400 | códigos `dynamic_link_destination_*` | URL inválida, insegura o incompatible |
| 401/403 | contrato auth existente | Acceso no autorizado |
| 404 | `dynamic_link_not_found` | Unidad inexistente |
| 409 | `dynamic_link_archived` | Unidad terminal |
| 409 | `dynamic_link_stale` | Otra sesión modificó la unidad |
| 502 | `dynamic_link_storage_failed` | Falló la dependencia de datos |

### Atomicity

La respuesta exitosa implica que etiqueta, tipo, destino, asociación, estado, revisión y auditoría se escribieron juntos. Cualquier error implica que ninguno de esos cambios se aplicó.

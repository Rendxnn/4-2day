# Data Model: Configuración rápida móvil de QR

## Resultado

El feature no añade tablas ni columnas. Reutiliza las entidades de `002-dynamic-links` y define un estado efímero de UI.

## Unidad de enlace existente

Campos usados:

| Field | Uso rápido | Regla |
| --- | --- | --- |
| `id` | Identificador de mutación | No se deriva del QR |
| `public_code` | Resolución exacta | Único, inmutable, 12 caracteres Crockford Base32 |
| `label` | “Etiqueta / nombre del lugar” | Trim, 1–160 caracteres |
| `destination_type` | Inferido en backend | Tipo permitido existente |
| `destination_url` | Destino pegado | HTTPS público y validación existente |
| `status` | Se establece o conserva en `active` | `archived` bloquea la operación |
| `revision` | Control de concurrencia | Debe coincidir con la lectura previa |
| `tenant_id`, `location_id`, `location_label_snapshot` | Asociación opcional | Omitidos para preservar, `null` para desasociar o derivados del negocio elegido |
| `activated_at` | Hito existente | Se establece solo al entrar por primera vez a `active` |
| `updated_at` | Hito existente | Se actualiza en la RPC |

## Evento de auditoría existente

La RPC genera un evento:

- `activated` si el estado anterior era `available` o `suspended`;
- `updated` si la unidad ya estaba `active`;
- `before_state` y `after_state` permiten reconstruir etiqueta, destino y estado;
- `actor_user_id` es el administrador autenticado.

No se modifica el check constraint de tipos de evento.

## Sesión efímera de configuración rápida

Unión discriminada local, no persistida:

```text
scanning  -> resolving(code) -> editing(unit, draft)
                                  -> submitting(unit, draft)
                                  -> success(unit)
                                  -> error(recoverTo, draft?)
```

Invariantes:

- solo una unidad puede estar resuelta por sesión;
- `submitting` contiene la revisión leída;
- los tracks existen únicamente en `scanning`;
- `success` conserva la unidad retornada por el servidor;
- un error de red conserva el draft; un cambio de código lo descarta explícitamente.
- el cambio de destino de una unidad activa pasa por un estado de confirmación antes de enviar.

## Concurrencia y transacción

`control.update_dynamic_link_unit` ejecuta `SELECT ... FOR UPDATE`, compara `p_expected_revision`, aplica todos los campos, incrementa revisión e inserta auditoría dentro de la misma transacción. Un request repetido con la revisión anterior produce `dynamic_link_stale` y no muta la fila.

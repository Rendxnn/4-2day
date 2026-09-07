# Modelo de datos

## `control.dynamic_link_batches`

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `id` | uuid | PK, generado por DB |
| `creation_request_id` | uuid | único; idempotencia de lote |
| `label` | text | etiqueta interna |
| `supplier_reference`, `notes` | text nullable | control operativo |
| `created_by`, `created_at` | uuid/timestamptz | trazabilidad |

## `control.dynamic_link_units`

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `id` | uuid | PK |
| `public_code` | text | único, 12 Crockford Base32, inmutable |
| `batch_id` | uuid nullable | FK a lote; `set null` no se usa en MVP |
| `label` | text | etiqueta interna |
| `tenant_id` | uuid nullable | FK `control.tenants` |
| `location_id`, `location_label_snapshot` | uuid/text nullable | ubicación opcional, sin FK cross-schema |
| `destination_type`, `destination_url` | enum lógico/text nullable | requeridos para activar |
| `status` | text | available/active/suspended/archived |
| `revision` | integer | control de concurrencia |
| `nfc_uid` | text nullable | único cuando se conoce |
| hitos | timestamptz nullable | printed/programmed/verified/locked |
| `activated_at`, `created_at`, `updated_at` | timestamptz | ciclo de vida |

## `control.dynamic_link_audit_events`

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `id` | uuid | PK |
| `unit_id` | uuid | FK, nunca cascade-delete |
| `batch_id` | uuid nullable | contexto de creación |
| `actor_user_id` | uuid nullable | null solo para trigger del sistema |
| `event_type` | text | `created`, `updated`, `activated`, `suspended`, `archived`, hitos |
| `before_state`, `after_state`, `metadata` | jsonb | append-only |
| `created_at` | timestamptz | orden de auditoría |

Relaciones: lote 1:N unidades; unidad 1:N eventos; negocio 1:N unidades. Una sede es un identificador opaco del esquema tenant para no romper aislamiento tenant.

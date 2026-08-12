# Arquitectura del frontend

## Alcance

`apps/dashboard` contiene tres experiencias en una aplicación React/Vite:

- operación del restaurante;
- administración de la plataforma;
- páginas públicas de ParaHoy Presencia Digital.

## Dirección arquitectónica

La unidad de organización es el feature. Cada feature reúne componentes, estado, contratos de vista y adaptadores HTTP de su capacidad. `App.tsx` compone navegación, sesión y layout; no debe absorber nuevas reglas de negocio ni pantallas completas.

```text
src/
  features/
    orders/
    configuration/
    public-carta/
    public-profile/
  shared/
  api.ts
  auth.ts
  App.tsx
```

La migración es incremental: se extrae una capacidad completa, se conserva una fachada temporal cuando sea necesaria y se elimina la duplicación después de verificarla.

## Acceso y seguridad

- `api.ts` llama a `apps/api` para lecturas y mutaciones de negocio.
- `auth.ts` usa Supabase Auth con la clave pública.
- Realtime se suscribe solo a tablas y schemas con grants, RLS y publication correctos.
- Ningún secreto de backend puede usar prefijo `VITE_`.

## Estado actual

Ya existen features separados para configuración, carta y perfil público. Las áreas de pedidos y el archivo `App.tsx` siguen siendo grandes. La experiencia humana carece de bandeja y compositor completos; Presencia Digital carece de la landing y autogestión objetivo.

El paquete sí tiene pruebas automatizadas bajo `apps/dashboard/test`; no debe volver a documentarse como carente de suite. Parte de estas pruebas caracteriza código fuente, por lo que se complementará con pruebas de comportamiento y E2E.

## Reglas de mantenimiento

- Los componentes no reproducen reglas de precios, permisos o transiciones del backend.
- Los estados remoto, de formulario y de navegación se mantienen separados.
- Contratos compartidos pertenecen a `packages/types`; contratos puramente visuales permanecen en el feature.
- Toda extracción conserva tests y no añade dependencias circulares.
- Cada cambio relevante ejecuta typecheck, tests y build del dashboard.

```bash
pnpm --filter @42day/dashboard typecheck
pnpm --filter @42day/dashboard test
pnpm --filter @42day/dashboard build
```

# ParaHoy Presencia Digital

## Experiencia estándar deseada

Una landing responsive basada inicialmente en una plantilla fija:

- logo, portada y colores principales;
- presentación del restaurante;
- horarios, ubicación, contacto y redes;
- llamados a ver la carta, escribir por WhatsApp, llamar, abrir Maps o responder la encuesta;
- carta del día con disponibilidad;
- concierge IA sobre productos y conocimiento autorizado.

El estándar incluye una URL de ParaHoy o dominio propio. Una página avanzada con diseño o secciones a medida se cotiza como extensión personalizada.

## Estado actual

### Actual

- Ruta pública de perfil por slug.
- Enlaces de WhatsApp, teléfono, redes, web, Maps y encuesta.
- Carta pública conectada al menú operativo.
- Concierge IA con historial acotado y conocimiento del restaurante.
- Configuración de perfil y carga/edición de conocimiento desde dashboard.

### Parcial

- El perfil es principalmente un hub de enlaces, no la landing completa.
- La identidad visual, información y autogestión no cubren todos los campos objetivo.
- El modo `standalone`/`connected` depende de `automation_enabled`; esto mezcla producto contratado y operación.

### Deseado

- Branding y contenido estándar completos.
- Horarios y dominio administrables.
- Autogestión de identidad, información, enlaces, catálogo, carta, disponibilidad y conocimiento.
- Carrito web con varias líneas que se transfiere a WhatsApp.
- Rate limiting, cuota y presupuesto controlado para el concierge público.

## Concierge

El concierge explica, compara y recomienda elementos de la carta usando únicamente datos del menú y conocimiento aprobado. No confirma pedidos, no altera el carrito, no inventa disponibilidad y no sustituye ParaHoy Pedidos.

Una respuesta que no pueda sostenerse con el contexto debe reconocer el límite y dirigir al restaurante o a WhatsApp. La exposición pública requiere protección contra abuso antes de escalar.

## Paquete completo

Cuando el tenant tiene ambos módulos, carta y WhatsApp comparten catálogo y disponibilidad. El carrito deseado contiene múltiples productos, cantidades y configuraciones suficientes para iniciar el contexto en WhatsApp; la confirmación, validación y pago continúan en ParaHoy Pedidos.

No se documenta como checkout web y no se infiere del estado de `automation_enabled`. Los entitlements técnicos independientes son trabajo pendiente.

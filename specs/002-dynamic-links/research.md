# Investigación y decisiones

## Decisión 1: host separado

`go.thaledon.com` será un Custom Domain de Cloudflare Worker. No se reutiliza `/r/:tenantSlug` del dashboard porque ya representa perfiles públicos de negocios. El requisito operativo previo es que `thaledon.com` tenga una zona Cloudflare activa; al momento del diagnóstico el DNS autoritativo estaba en GoDaddy.

## Decisión 2: semántica pública

La ruta será `GET|HEAD /r/:code`. Solo una unidad `active`, con destino válido y con tenant activo si tiene tenant asignado, produce `302`. Todos los demás estados responden HTML genérico no cacheable: disponible 200, suspendida 403, archivada 410, desconocida 404 y dependencia/configuración 503.

## Decisión 3: QR y NFC

Un URL de 38 caracteres con código de 12 caracteres se ajusta a QR versión 3 con corrección M: 29 módulos; con quiet zone de 4 módulos son 37 módulos. A 25 mm entrega módulos de ~0.68 mm. Se elige SVG, negro/blanco y margen 4; PNG es una conversión para usos no vectoriales. QR y NFC contienen el mismo URL NDEF URI.

## Decisión 4: privacidad

No se guarda analítica en el MVP. En consecuencia, no se diferencia QR de NFC ni se registran IP, user-agent o identificadores de visitantes.

## Decisión 5: seguridad de destino

Solo HTTPS. Se rechazan credenciales URL, IP literals, localhost, dominios `.local`, esquemas no web y el host canónico de redirect. Google Reviews, WhatsApp e Instagram deben usar hosts oficiales; website/menu pueden usar HTTPS público válido.

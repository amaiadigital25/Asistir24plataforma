# Automatización Gmail Asistir24

Flujo productivo:
1. Gmail recibe `Nuevo traslado ... para cotizar`.
2. Se extraen ID Asistencia, empresa, origen, destino, vehículo, patente, observaciones y asegurado.
3. Se selecciona una base activa, se calculan recorridos y se crea la cotización.
4. Cotización y remito quedan guardados en `ESPERANDO_CONFIRMACION`.
5. Gmail recibe `Se te ASIGNÓ ...` y se empareja por ID Asistencia.
6. El estado pasa a `LISTO_PARA_WHATSAPP`.
7. El operador envía manualmente por WhatsApp desde el panel.

Seguridad:
- OAuth usa `gmail.modify`.
- El refresh token queda cifrado en la base persistente con AES-256-GCM.
- Los IDs de mails procesados se guardan para evitar duplicados.
- WhatsApp no se envía automáticamente.

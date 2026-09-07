# Asistir24 - Plataforma cerrada de prueba

Prototipo operativo privado para probar el cotizador y la red de prestadores.

## Incluye
- Login con JWT y expiracion de 8 horas.
- Panel de administracion para altas, bajas, bloqueo, roles y cambio de contraseña de usuarios.
- 57 bases cargadas desde `RED DE PRESTADORES.pdf`.
- Cotizador con movida ARS 43.989 y ARS 1.199 por kilometro.
- CABA/AMBA: Base -> Origen -> Destino.
- Interior: Base -> Origen -> Destino -> Base.
- Tipos de servicio: Liviano, Auxilio mecanico y Semipesado.
- Buscador de bases y filtro CABA/AMBA vs Interior.
- Historial temporal de cotizaciones.

## Distancias en esta prueba
El PDF informa localidades/bases pero no direcciones exactas ni coordenadas de todas las unidades. Por eso los kilometros se cargan manualmente por tramo y el sistema aplica automaticamente la regla de regreso a base.

## Variables recomendadas para Railway
- `JWT_SECRET`: clave larga y aleatoria.
- `ADMIN_USER`: usuario administrador.
- `ADMIN_PASSWORD`: contraseña administradora.
- `APP_ORIGIN`: origen permitido si frontend y backend se separan.
- `DATA_FILE`: ruta persistente del archivo JSON de usuarios (por ejemplo `/data/database.json` en un volumen de Railway).

Si no se configura `JWT_SECRET`, el servidor genera una clave temporal en cada arranque. Para produccion debe usarse una base de datos persistente para usuarios y cotizaciones.

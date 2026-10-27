# Ciclo — Correos de Gmail → webhook (Apps Script)

Los correos de BCP e Interbank se leen **en el servidor de Google**, no en el iPhone, así que funciona con el teléfono apagado. Código: [integrations/apps-script/Code.gs](../integrations/apps-script/Code.gs).

Hazlo **después** de desplegar y de probar el webhook con `curl` ([05-despliegue.md](05-despliegue.md)).

## 1. Filtro de Gmail (etiqueta `ciclo/banco`)
Gmail → engranaje → *Ver todos los ajustes* → *Filtros y direcciones bloqueadas* → *Crear un filtro nuevo*. En **De** pon:

```
notificaciones@notificacionesbcp.com.pe OR bcpcomunica@email.bcp.com.pe OR interbank.pe OR netinterbank.com.pe
```

*Crear filtro* → marca **Aplicar la etiqueta** → *Nueva etiqueta…* → `ciclo/banco`. Marca también *Aplicar también a las conversaciones que coincidan* solo si quieres reenviar los últimos días (el servidor rechaza correos de más de 7 días).

> Los remitentes de Interbank no están verificados (mi muestra eran capturas sin cabecera). Abre uno de sus correos → *Mostrar original* y confirma el dominio del remitente; ajusta el filtro si es otro.

## 2. Crear el script
1. Entra a <https://script.google.com> con la misma cuenta de Gmail → *Proyecto nuevo*.
2. Borra el contenido y pega todo `Code.gs`.
3. *Configuración del proyecto* (engranaje) → **Propiedades del script** → añade:
   - `CICLO_URL` = `https://<tu-app>.vercel.app`
   - `CICLO_TOKEN` = el token de `npm run token:create -- "Gmail Apps Script"`
4. En el editor elige la función `install` → *Ejecutar* → acepta los permisos de Gmail y de "conectarse a un servicio externo". Crea las etiquetas `ciclo/enviado` y `ciclo/error` y un activador de cada minuto.
5. Para probar sin esperar: elige `processBankEmails` → *Ejecutar* → mira *Ejecuciones*.

## Qué hace con cada respuesta
| Respuesta | Acción |
|---|---|
| 200 / 201 / 202 | Hilo marcado `ciclo/enviado` (registrado, duplicado, en revisión o ignorado) |
| 429 / 5xx / sin red | Se reintenta en la próxima ejecución |
| 400 / 401 / 403 / 413 | Hilo marcado `ciclo/error`; revisa el token o el mensaje |

Cada mensaje viaja con `Idempotency-Key = id del mensaje de Gmail`, así que un reintento nunca duplica el movimiento. Los logs no incluyen texto del correo.

## Límites
- Apps Script gratis: ~20,000 llamadas `UrlFetch` al día; revisar cada minuto usa unas 1,440 y solo hace POST si hay correos nuevos.
- Google puede retrasar un activador unos minutos. No es tiempo real.

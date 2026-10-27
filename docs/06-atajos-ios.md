# Ciclo — Atajos de iOS

Los nombres de acciones son los de iOS en español; pueden variar un poco según la versión. Todos los Atajos hacen lo mismo: arman el texto, lo envían y muestran la respuesta. El parsing lo hace el servidor.

Antes: crea un token **solo manual** (no puede registrar movimientos bancarios): `npm run token:create -- "iPhone Atajos" manual`.

## A. Efectivo en 2 toques ("Gasto efectivo")
1. **Pedir entrada** → tipo *Número*, pregunta "¿Cuánto?" → variable `Monto`.
2. **Elegir del menú** → "Categoría": Comida, Transporte, Compras, Salud, Entretenimiento, Otros. En cada opción, **Texto** con el nombre en minúscula (ej. `comida`) → al final del menú, variable `Cat`.
3. **Texto**: `Monto Cat` (ej. `12.5 comida`). Para dólares: `$5 cafe`. Para un ingreso en efectivo: `+80 venta`.
4. **Obtener contenido de URL**
   - URL: `https://<tu-app>.vercel.app/api/v1/ingest`
   - Método: **POST**
   - Encabezados: `Authorization` = `Bearer <TOKEN>` · `Content-Type` = `application/json`
   - Cuerpo de la solicitud: **JSON** con campos de texto:
     - `source` = `manual`
     - `sender` = `iphone-atajo`
     - `raw_text` = (variable del paso 3)
     - `received_at` = **Fecha actual** con formato *ISO 8601* (acción *Dar formato a fecha*)
     - `device_id` = `iphone`
5. **Obtener valor del diccionario** → clave `message` del resultado.
6. **Mostrar notificación** con ese valor (ej. "Efectivo: S/ 12.50 en Comida").

Ponlo en la pantalla de inicio, en el Botón de Acción (*Ajustes → Botón de acción → Atajo*) o con Siri ("Gasto efectivo").

**Ingresos por Yape que no llegan por correo:** duplica el Atajo, nómbralo "Ingreso Yape" y en el paso 3 antepón `+` (ej. `+25 venta`). Se registra como ingreso en **Efectivo**; si prefieres que entre a tu cuenta, dímelo y añadimos un parámetro de cuenta.

## B. Automatización de SMS (opcional, hoy no necesaria)
Tus bancos te avisan por correo, que ya cubre Gmail. Úsala solo si algún banco te manda un SMS que no llega por correo:
1. Atajos → *Automatización* → **+** → **Mensaje** → *Mensaje contiene* un texto del banco (ej. `BCP`) → **Ejecutar de inmediato**.
2. Acciones: *Obtener contenido de URL* igual que arriba pero con `source` = `sms`, `sender` = **Remitente** del mensaje, `raw_text` = **Mensaje**. Ese Atajo necesita un token con alcance completo (`ingest:all`); no uses el token solo-manual.
3. Mostrar la notificación con `message`.

## Cuando falla
- *No se pudo conectar*: sin internet; el movimiento no se envió, repítelo.
- Respuesta `401`: token mal copiado o revocado.
- Si tocas dos veces seguidas en el mismo segundo, el servidor descarta el duplicado.

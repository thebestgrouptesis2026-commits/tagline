# Ciclo — Contrato de la API

Base: `https://<tu-app>.vercel.app`. Solo HTTPS. JSON UTF-8.

Hay dos superficies con autenticación distinta:

| Superficie | Auth | Quién la usa |
|---|---|---|
| `/api/v1/ingest` | `Authorization: Bearer ck_live_…` (token de dispositivo) | Apps Script, Atajos |
| `/api/v1/*` (resto) | Cookie de sesión Auth.js | Dashboard PWA |
| `/api/cron/daily` | `Authorization: Bearer $CRON_SECRET` | Vercel Cron |

Las pantallas del dashboard leen datos con Server Components y mutan con Server Actions. Los endpoints REST de abajo existen para el cliente PWA (acciones optimistas) y para exportar.

## Formato de error (todas las rutas)

```json
{ "error": { "code": "validation_error", "message": "raw_text es obligatorio", "details": [{ "path": "raw_text", "issue": "required" }] } }
```

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `validation_error` | Zod rechaza el cuerpo |
| 401 | `unauthorized` | Falta el token, no existe, está revocado o expiró |
| 403 | `forbidden_scope` | Token `ingest:manual` enviando `source` sms/email |
| 409 | `idempotency_conflict` | Misma `Idempotency-Key` con un cuerpo distinto |
| 413 | `payload_too_large` | Cuerpo > 16 KB |
| 415 | `unsupported_media_type` | No es `application/json` |
| 422 | `unparseable` | Solo en `manual`: monto no interpretable |
| 429 | `rate_limited` | > 30 req/min por token (cabecera `Retry-After`) |
| 500 | `internal_error` | Sin detalles internos; se registra un `requestId` |

---

## `POST /api/v1/ingest`

**Cabeceras:** `Authorization: Bearer <token>`, `Content-Type: application/json`, `Idempotency-Key: <opcional, ≤128 chars>`

**Cuerpo:**

```json
{
  "source": "email",
  "sender": "notificaciones@bcp.com.pe",
  "raw_text": "…texto completo del correo…",
  "received_at": "2026-10-27T14:03:11Z",
  "device_id": "gmail-apps-script"
}
```

| Campo | Regla |
|---|---|
| `source` | `"sms" \| "email" \| "manual"` |
| `sender` | 1–200 chars |
| `raw_text` | 1–12,000 chars (se recorta el HTML del correo en el cliente) |
| `received_at` | ISO 8601 con zona; se rechaza si está más de 7 días en el pasado o más de 10 min en el futuro |
| `device_id` | 1–64 chars `[A-Za-z0-9._-]` |

**Entrada manual (Atajo de efectivo)**: `source: "manual"` y `raw_text` con formato libre corto. Ejemplos válidos: `"12.50 comida"`, `"S/ 8 taxi"`, `"$5 cafe"`. El parser manual lee el monto, la moneda (S/ por defecto) y la categoría por nombre o alias. La cuenta es `Efectivo` en la moneda indicada.

**Respuesta `201 Created`** (registrado):

```json
{
  "status": "recorded",
  "event_id": "8f0e…",
  "transaction_id": "c1a2…",
  "message": "S/ 45.90 en Plaza Vea → Visa Interbank",
  "confidence": 0.95
}
```

**Respuesta `202 Accepted`** (a revisión):

```json
{
  "status": "needs_review",
  "event_id": "8f0e…",
  "transaction_id": "c1a3…",
  "message": "Revisar: S/ 120.00 sin cuenta identificada",
  "confidence": 0.55
}
```

**Respuesta `200 OK`** (duplicado, devuelve el mensaje original):

```json
{ "status": "duplicate", "event_id": "8f0e…", "message": "Ya registrado: S/ 45.90 en Plaza Vea → Visa Interbank" }
```

**Respuesta `200 OK`** (correo sin movimiento, ej. publicidad):

```json
{ "status": "ignored", "event_id": "8f0f…", "message": "Correo sin movimiento" }
```

Ejemplos de `message`:
- `Sueldo recibido: S/ 1,320.00 → BCP Sueldo`
- `Pago de tarjeta: S/ 300.00 BCP → Visa Interbank`
- `Efectivo: S/ 12.50 en Comida`

> El estado `failed` (parser lanzó una excepción) responde `202 needs_review` al cliente: el evento queda guardado y no se pierde.

---

## Dashboard (sesión)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/summary?month=2026-10` | Ingresos, gastos, disponible hasta el sueldo, próximos pagos |
| GET | `/api/v1/transactions?cursor=&q=&account=&category=&kind=&from=&to=&status=` | Lista paginada por cursor (50 por página) |
| POST | `/api/v1/transactions` | Alta manual (mismo formato que una fila) |
| PATCH | `/api/v1/transactions/:id` | Recategorizar o editar; `{ "category_id": "…", "learn": true }` crea una regla aprendida |
| DELETE | `/api/v1/transactions/:id` | Borrado lógico |
| POST | `/api/v1/transactions/:id/approve` | Pasa de `pending_review` a `posted` (acepta correcciones en el cuerpo) |
| GET | `/api/v1/transactions/export.csv?from=&to=` | CSV (UTF-8 con BOM para Excel, `;` como separador) |
| GET/POST/PATCH/DELETE | `/api/v1/accounts`, `/credit-cards`, `/income-sources`, `/recurring-expenses`, `/budgets`, `/savings-goals`, `/categories`, `/rules` | CRUD estándar |
| GET | `/api/v1/credit-cards/:id/cycle?at=2026-10-27` | Ciclo actual: inicio, corte, vencimiento, consumo PEN/USD, cuotas del ciclo |
| POST | `/api/v1/ingest-events/:id/reprocess` | Reprocesa con la versión actual del parser |
| GET/POST/DELETE | `/api/v1/tokens` | Lista, crea (devuelve el token en claro **una vez**), revoca. `POST /tokens/:id/rotate` |
| PUT | `/api/v1/exchange-rates/:day` | `{ "rate": "3.7520" }` tipo de cambio manual USD→PEN |
| POST | `/api/v1/push/subscribe` | Guarda la suscripción Web Push |
| GET | `/api/v1/alerts?unread=1` · `POST /alerts/:id/read` | Alertas |

**Ejemplo `GET /api/v1/summary?month=2026-10`:**

```json
{
  "month": "2026-10",
  "income":   { "PEN": 182000, "USD": 0 },
  "expenses": { "PEN": 97550,  "USD": 1299 },
  "consolidated": { "currency": "PEN", "income": 182000, "expenses": 102423, "fx_rate": "3.7520", "fx_day": "2026-10-26" },
  "available_until_payday": {
    "next_payday": "2026-11-27",
    "by_currency": { "PEN": 64320 },
    "consolidated_pen": 64320,
    "breakdown": { "balance": 158000, "pending_fixed": -12000, "card_payments_due": -81680 }
  },
  "upcoming": [
    { "type": "card_payment", "name": "Visa Interbank", "due_date": "2026-11-20", "amount": { "PEN": 81680, "USD": 1299 } }
  ]
}
```

Todos los montos van en céntimos (enteros) con la moneda como clave o campo `currency`.

## `GET /api/cron/daily` (Vercel Cron)

Corre a las `0 13 * * *` UTC (08:00 Lima). Es idempotente gracias a `alerts.dedupe_key`. Hace lo siguiente:

1. Genera alertas de pagos próximos (tarjeta 5/2/0 días antes, fijos según `remind_days_before`).
2. Avisa si el sueldo no llegó (fecha esperada ajustada + `grace_days`).
3. Avisa si un presupuesto está cerca o pasó el límite, o si el uso de la línea supera el %.
4. Detecta recurrentes: mismo comercio normalizado, 3 o más cobros con un intervalo de 28–31 días y monto dentro de ±15%.
5. Detecta gasto inusual: categoría del mes por encima de la media + 2σ de los últimos 6 meses.
6. Envía las alertas `urgent` nuevas por Web Push y por Telegram si está configurado.

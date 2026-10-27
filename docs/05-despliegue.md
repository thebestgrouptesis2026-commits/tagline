# Ciclo — Guía de despliegue (Vercel + Neon)

Pensada para alguien que nunca usó Vercel. Orden: repositorio → base de datos → Vercel → migraciones → probar con `curl` → recién después Apps Script y Atajos.

## 0. En tu computadora
Necesitas **Node.js 22 LTS** (<https://nodejs.org>) y Git. Esta máquina todavía no tiene Node: instálalo y ejecuta `npm install`.

## 1. Repositorio privado en GitHub
1. <https://github.com/new> → nombre `ciclo` → **Private** → sin README → *Create*.
2. En la carpeta del proyecto:
   ```bash
   git remote add origin https://github.com/<tu-usuario>/ciclo.git
   git push -u origin main
   ```

## 2. Base de datos en Neon
1. <https://neon.tech> → cuenta gratis → *New project* → región **São Paulo (sa-east-1)** (la más cercana a Lima).
2. Copia dos cadenas de conexión (*Connect*): la **pooled** (host con `-pooler`) y la **directa**. Serán `DATABASE_URL` y `DATABASE_URL_UNPOOLED`.

## 3. Importar en Vercel
1. <https://vercel.com> → entra con GitHub → *Add New… → Project* → elige `ciclo` → framework *Next.js* (se detecta solo). **No pulses Deploy aún.**
2. **Neon ↔ Vercel:** en *Storage* conecta Neon. Así producción usa la rama `main` y cada *preview* recibe su propia rama de base de datos, sin tocar tus datos reales.
3. *Settings → Environment Variables* (marca Production y Preview salvo que se indique):

| Variable | Valor |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | las crea la integración de Neon (o pégalas) |
| `AUTH_SECRET` | `openssl rand -base64 33` |
| `ALLOWED_EMAILS` | tu Gmail |
| `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM` | de <https://resend.com> (gratis); sin dominio usa `Ciclo <onboarding@resend.dev>` |
| `CRON_SECRET` | `openssl rand -hex 24` (mín. 32 caracteres) |

   Las variables `VAPID_*` y `TELEGRAM_BOT_TOKEN` son de la fase v1 (alertas); déjalas vacías por ahora.
4. *Deploy*. Cada `git push` a `main` redespliega solo; cada rama o PR genera un *preview*.

## 4. Migraciones y datos iniciales (desde tu computadora)
```bash
cp .env.example .env          # pega DATABASE_URL_UNPOOLED, DATABASE_URL, SEED_EMAIL
npm install
npm run db:migrate
cp scripts/seed.config.example.json scripts/seed.config.json   # edítalo: tu nombre completo, cuentas, tarjetas
npm run db:seed
npm run token:create -- "curl de prueba"
```
`seed.config.json` ya está en `.gitignore`. Pon en `fullName` tu nombre como sale en los bancos (sirve para reconocer transferencias a ti mismo). Las tarjetas deben tener sus **últimos 4 dígitos reales** y los cortes correctos (iO: 26, Interbank: 27, pago 20).

## 5. Probar el webhook con `curl`
```bash
curl -i https://<tu-app>.vercel.app/api/v1/ingest \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"source":"manual","sender":"curl","raw_text":"12.50 comida","received_at":"'$(date -u +%FT%TZ)'","device_id":"curl"}'
```
Debe responder `201` con `"message": "Efectivo: S/ 12.50 en Comida"`. Repite el mismo comando dentro del mismo segundo → `200 duplicate`. Un token incorrecto → `401`. Abre la app, inicia sesión con tu correo y verás el movimiento.

## 6. Después
1. [04-gmail-apps-script.md](04-gmail-apps-script.md) para los correos bancarios.
2. [06-atajos-ios.md](06-atajos-ios.md) para el efectivo.
3. Instala la PWA: Safari → Compartir → *Añadir a pantalla de inicio*.

## Cron diario
`vercel.json` programa `/api/cron/daily` a las 08:00 Lima. **Esa ruta aún no existe** (alertas y recurrentes son fase v1); hasta entonces el cron responderá 404, sin efecto sobre la app.

## Problemas típicos
- `401` en el webhook: token mal copiado, revocado, o falta `Bearer `.
- Migración falla: usaste la cadena *pooled* en `DATABASE_URL_UNPOOLED`.
- Movimiento en *Revisión*: el parser no encontró la cuenta; revisa los últimos 4 dígitos del seed.

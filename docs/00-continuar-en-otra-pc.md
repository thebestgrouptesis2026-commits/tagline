# Ciclo — Cómo retomar el proyecto en otra computadora

La conversación con Claude no se conserva entre sesiones ni entre computadoras. Este archivo es el traspaso: dónde estamos, qué falta y qué comandos correr. Si abres una sesión nueva de Claude Code, dile: *"Lee docs/00-continuar-en-otra-pc.md y continúa desde ahí."*

## Estado (2026-10-27)
- Entregables 1–6 del prompt original hechos: arquitectura, esquema (26 tablas), API, estructura, código inicial (ingesta, parsers, ciclo, disponible, pantalla de inicio).
- Entregables 7–9 escritos: [04-gmail-apps-script.md](04-gmail-apps-script.md), [05-despliegue.md](05-despliegue.md), [06-atajos-ios.md](06-atajos-ios.md), [07-fases.md](07-fases.md).
- `npm run typecheck` y `npm test` pasan (85 tests) con Node 22.
- 2026-10-27 (noche): base Neon creada, migrada y con semilla real; login con Resend funciona en local. Pantallas de Movimientos y Revisión y barra inferior hechas. **Aún no hay nada en Vercel.** Ninguna credencial real está en el repo (`.env` y `scripts/seed.config.json` son locales: en otra PC hay que recrearlos).

## Decisiones tomadas (resumen; detalle en [01-arquitectura.md](01-arquitectura.md))
- Perú, America/Lima, PEN + USD. Sueldo S/ 1,320 al BCP el 27–28 (`PLANILLA`).
- Tarjetas: **BCP iO** corte 26 / pago 12; **Interbank Visa Clásica** corte 27 / pago 20 (si el día de pago es no hábil, se adelanta).
- Correos leídos desde **Gmail** con Apps Script (no SMS, no Atajos para bancos). Atajo solo para efectivo.
- Ingresos diarios por **Yape** y a veces transferencias BCP.
- Neon (Postgres) + Auth.js con passkeys + Vercel Hobby.
- Plin/Yape a uno mismo = movimiento interno (requiere `fullName` en el seed).

## Pasos en la PC nueva
```bash
# 1. Node 22 con nvm (macOS/Linux)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
nvm install 22 && nvm use 22
# (Windows: instala Node 22 LTS desde https://nodejs.org o usa WSL)

# 2. Código
git clone https://github.com/thebestgrouptesis2026-commits/tagline.git ~/tagline   # o: git pull
cd ~/tagline
npm install
npm run typecheck && npm test      # deben pasar los 85 tests
```

## Neon y entorno (solo en la PC personal; nunca subas `.env`)
1. <https://neon.tech> → proyecto en São Paulo → copia la cadena **pooled** (host con `-pooler`) y la **directa**.
2. `cp .env.example .env` y completa `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (directa), `AUTH_SECRET` (`openssl rand -base64 33`), `SEED_EMAIL`, `ALLOWED_EMAILS`.
3. Tablas y datos:
   ```bash
   npm run db:migrate
   cp scripts/seed.config.example.json scripts/seed.config.json   # edítalo: fullName, últimos 4 reales, cortes
   npm run db:seed
   npm run token:create -- "prueba local"     # copia el token, no se vuelve a mostrar
   ```
4. Probar en local: `npm run dev` y, en otra terminal, el `curl` de [05-despliegue.md](05-despliegue.md#5-probar-el-webhook-con-curl) (debe dar `201 "Efectivo: S/ 12.50 en Comida"`).
5. Después: Vercel ([05-despliegue.md](05-despliegue.md)), Apps Script ([04](04-gmail-apps-script.md)) y Atajo ([06](06-atajos-ios.md)).

## Pendiente (en orden)
2. **Correos reales en texto plano** (Gmail → ⋮ → *Mostrar original*, con datos sensibles tapados) para reemplazar fixtures sintéticos: abono de planilla BCP, consumo con la Visa Interbank, pago de tarjeta y el remitente real de Interbank (el Yape recibido ya se verificó el 27/10) para el filtro de Gmail.
3. Confirmar en el seed: red de la iO (¿Visa?), monedas y últimos 4 de cada tarjeta/cuenta.
4. Construir: Cuentas, Tarjetas, Estadísticas (ver [07-fases.md](07-fases.md)).
5. `/api/cron/daily` no existe aún (alertas y recurrentes, v1).

## Notas técnicas
- Parsers: `src/parsers/` (BCP v2, Interbank v1, manual). Los formatos no verificados restan confianza y van a Revisión; el texto crudo siempre se guarda en `ingest_events`.
- Los bancos no publican plantillas de correo: no inventar expresiones regulares, usar correos reales.
- Un yapeo a tu propio número sin cuenta destino conocida cae en Revisión a propósito.

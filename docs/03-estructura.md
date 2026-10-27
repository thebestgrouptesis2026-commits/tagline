# Ciclo — Estructura de carpetas

```
ciclo/
├─ drizzle/                      # Migraciones SQL generadas (drizzle-kit generate) — versionadas en git
├─ public/
│  ├─ icons/                     # icon-192.png, icon-512.png, maskable, apple-touch-icon
│  └─ sw.js                      # Service worker: push + caché de shell
├─ scripts/
│  ├─ seed.ts                    # Usuario, categorías base, feriados PE, cuentas iniciales
│  ├─ seed.config.example.json   # Copiar a seed.config.json (ignorado por git) con tus datos
│  ├─ create-token.ts            # Crea un token de dispositivo y lo muestra una sola vez
│  └─ gmail-apps-script.gs       # Script para pegar en script.google.com (entregable 7)
├─ src/
│  ├─ app/                       # ── Capa de entrega (rutas). Sin lógica de negocio.
│  │  ├─ (auth)/login/           # Passkey + enlace por correo
│  │  ├─ (app)/                  # Layout protegido + navegación inferior + FAB
│  │  │  ├─ page.tsx             # Inicio
│  │  │  ├─ movimientos/
│  │  │  ├─ cuentas/
│  │  │  ├─ tarjetas/[id]/
│  │  │  ├─ fijos/
│  │  │  ├─ presupuesto/
│  │  │  ├─ revision/
│  │  │  ├─ reportes/
│  │  │  └─ ajustes/             # cuentas, tarjetas, sueldo, categorías, reglas, tokens
│  │  ├─ api/
│  │  │  ├─ v1/ingest/route.ts   # Webhook
│  │  │  ├─ v1/…/route.ts        # REST del dashboard
│  │  │  ├─ cron/daily/route.ts
│  │  │  └─ auth/[...nextauth]/route.ts
│  │  ├─ manifest.ts             # Manifest PWA
│  │  └─ layout.tsx
│  │
│  ├─ domain/                    # ── Núcleo puro: SIN imports de DB, Next ni fetch. 100% testeable.
│  │  ├─ money.ts                # Tipo Money, suma por moneda, formateo es-PE, conversión con TC
│  │  ├─ dates.ts                # Lima ⇄ UTC, días hábiles con calendario inyectado
│  │  ├─ billing-cycle.ts        # Ciclo de la tarjeta: a qué corte pertenece una fecha, vencimiento ajustado
│  │  ├─ installments.ts         # Cronograma de cuotas (TEA→TEM, sistema francés)
│  │  ├─ payday.ts               # Próxima fecha de sueldo ajustada
│  │  ├─ available.ts            # Disponible hasta el próximo sueldo
│  │  ├─ categorize.ts           # Motor de reglas comercio → categoría
│  │  ├─ recurring.ts            # Detección de cobros recurrentes
│  │  └─ *.test.ts               # Vitest, junto a cada módulo
│  │
│  ├─ parsers/                   # ── Strategy: texto crudo → ParsedMovement
│  │  ├─ types.ts                # interface BankParser { id, version, canParse(), parse() }
│  │  ├─ registry.ts             # Orden de evaluación y selección por remitente/contenido
│  │  ├─ normalize.ts            # Limpieza de texto, montos "1,320.00", "S/", "US$"
│  │  ├─ bcp/                    # index.ts + fixtures/*.txt + bcp.test.ts
│  │  ├─ interbank/
│  │  └─ manual/
│  │
│  ├─ services/                  # ── Casos de uso: orquestan dominio + repositorios en una transacción
│  │  ├─ ingest.service.ts       # auth token → idempotencia → evento → parser → categoría → tx
│  │  ├─ transactions.service.ts # recategorizar (+ aprender regla), aprobar, transferencias
│  │  ├─ summary.service.ts      # Datos de Inicio
│  │  ├─ alerts.service.ts       # Lo que corre el cron
│  │  └─ notify.service.ts       # Web Push + Telegram
│  │
│  ├─ repositories/              # ── Acceso a datos. Toda función recibe userId como 1er argumento.
│  │  ├─ accounts.repo.ts
│  │  ├─ transactions.repo.ts
│  │  ├─ ingest-events.repo.ts
│  │  └─ …
│  │
│  ├─ db/
│  │  ├─ schema.ts               # Esquema Drizzle
│  │  └─ client.ts               # drizzle(neon(DATABASE_URL))
│  │
│  ├─ lib/                       # ── Infraestructura transversal
│  │  ├─ env.ts                  # Variables de entorno validadas con Zod (falla al arrancar si falta algo)
│  │  ├─ auth.ts                 # Config Auth.js + getUserOrThrow()
│  │  ├─ api-token.ts            # Generar, hashear y verificar tokens
│  │  ├─ rate-limit.ts           # Ventana fija en Postgres (sin Redis en MVP)
│  │  ├─ http.ts                 # jsonError(), lectura de body con límite de tamaño
│  │  └─ logger.ts               # Logs estructurados con redacción de raw_text y tokens
│  │
│  ├─ components/
│  │  ├─ ui/                     # shadcn/ui (generado)
│  │  ├─ money/                  # <Amount/> con signo y color semántico, tabular-nums
│  │  ├─ charts/                 # Recharts
│  │  └─ …                       # tarjetas de resumen, filas de movimiento, FAB, estados vacíos
│  │
│  └─ styles/globals.css         # Tokens (claro/oscuro) como variables CSS → Tailwind
├─ .env.example
├─ drizzle.config.ts
├─ vercel.json                   # Cron
└─ vitest.config.ts
```

## Reglas de dependencia

```
app  →  services  →  domain
              ↘  repositories → db
parsers → domain (solo money/normalize)
```

- `domain/` no importa nada de afuera. Las fechas "hoy" y los feriados entran como parámetros, así los tests son deterministas.
- `repositories/` es el único lugar con consultas. Toda función tiene la firma `(executor, userId, …)`, donde `executor` es la conexión o una transacción abierta. La única excepción es `findActiveTokenByHash`, que es justamente la que resuelve el `userId`. Una regla de lint (`no-restricted-imports`) prohíbe importar `db/client` fuera de `repositories/` y `services/`.
- `app/` solo valida la entrada (Zod), resuelve la sesión o el token y llama a un servicio.

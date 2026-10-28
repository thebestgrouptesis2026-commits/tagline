# Ciclo — Plan por fases

## MVP (hecho en gran parte)
- [x] Arquitectura, esquema (26 tablas), contrato de API.
- [x] Webhook `/api/v1/ingest`: token por dispositivo, rate limit, Zod, idempotencia.
- [x] Parsers: BCP (transferencia, consumo con débito, yapeo), Interbank (Plin), manual.
- [x] Ciclo de facturación, sueldo y "disponible hasta el sueldo", con tests.
- [x] Login con enlace por correo y passkeys; pantalla de inicio mobile-first; PWA.
- [x] Transferencias a uno mismo (Plin/Yape) como movimiento interno.
- [x] Apps Script de Gmail, guías de Atajos y despliegue.
- [x] Correr `npm install`, `npm test` y `npm run typecheck`.
- [x] Base en Neon migrada y con semilla real; login por correo (Resend) probado en local.
- [ ] Desplegar y probar con `curl`.
- [x] Barra inferior y pantalla de **Movimientos** (lista por día, filtros, recategorizar con aprendizaje).
- [ ] Bandeja de **Revisión**.
- [ ] Pantallas de **Cuentas** y **Tarjetas**.

## v1
- Parsers con ejemplos reales: Interbank (consumo de la Visa, pagos), BCP/iO (compra con tarjeta de crédito, pago de tarjeta, sueldo, **yape recibido**).
- Cron diario `/api/cron/daily`: recurrentes, sueldo no recibido, gasto inusual.
- Alertas: Web Push de la PWA (requiere instalarla; iOS 16.4+) y Telegram para urgentes.
- Presupuestos, metas, fijos y suscripciones, cuotas, estados de cuenta reales.
- Reportes y exportación CSV; gestión de tokens desde Ajustes.
- Firma HMAC opcional para Apps Script.

## Mejoras futuras
Importar estados de cuenta en PDF, OCR de recibos, gastos compartidos, reportes anuales, tipo de cambio automático.

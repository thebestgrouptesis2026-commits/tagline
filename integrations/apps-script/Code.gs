/**
 * Ciclo — lector de correos bancarios (Google Apps Script).
 *
 * Qué hace: cada minuto busca hilos con la etiqueta `ciclo/banco` que aún no tengan `ciclo/enviado`,
 * manda el texto de cada mensaje a POST /api/v1/ingest y marca el hilo como enviado.
 * Funciona aunque el iPhone esté apagado. Guía de instalación: docs/04-gmail-apps-script.md
 *
 * Propiedades del script (Configuración del proyecto → Propiedades del script):
 *   CICLO_URL    https://<tu-app>.vercel.app
 *   CICLO_TOKEN  token creado con `npm run token:create` (alcance ingest:all)
 */
var LABEL_SOURCE = "ciclo/banco";
var LABEL_DONE = "ciclo/enviado";
var LABEL_ERROR = "ciclo/error";
var MAX_THREADS_PER_RUN = 20;
// La API rechaza received_at con más de 7 días de antigüedad: no insistas con mensajes más viejos.
var MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000;
var MAX_RAW_TEXT = 12000;

function processBankEmails() {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = props.getProperty("CICLO_URL");
  var token = props.getProperty("CICLO_TOKEN");
  if (!baseUrl || !token) throw new Error("Faltan las propiedades CICLO_URL y CICLO_TOKEN");

  // Evita ejecuciones solapadas si una tarda más de un minuto.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var done = getOrCreateLabel_(LABEL_DONE);
    var failed = getOrCreateLabel_(LABEL_ERROR);
    var query = 'label:"' + LABEL_SOURCE + '" -label:"' + LABEL_DONE + '" -label:"' + LABEL_ERROR + '"';
    var threads = GmailApp.search(query, 0, MAX_THREADS_PER_RUN);

    threads.forEach(function (thread) {
      var outcome = "ok";
      thread.getMessages().forEach(function (message) {
        if (outcome === "retry") return;
        var r = sendMessage_(baseUrl, token, message);
        if (r === "retry") outcome = "retry";
        else if (r === "fail") outcome = "fail";
      });
      if (outcome === "ok") thread.addLabel(done);
      else if (outcome === "fail") thread.addLabel(failed);
      // "retry": se deja sin etiquetar y se reintenta en la próxima ejecución.
    });
  } finally {
    lock.releaseLock();
  }
}

/** @return {"ok"|"retry"|"fail"} */
function sendMessage_(baseUrl, token, message) {
  var receivedAt = message.getDate();
  if (Date.now() - receivedAt.getTime() > MAX_AGE_MS) return "ok"; // muy viejo: la API lo rechazaría
  var body = {
    source: "email",
    sender: message.getFrom(),
    raw_text: message.getPlainBody().slice(0, MAX_RAW_TEXT),
    received_at: receivedAt.toISOString(),
    device_id: "apps-script",
  };
  var res;
  try {
    res = UrlFetchApp.fetch(baseUrl.replace(/\/$/, "") + "/api/v1/ingest", {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token, "Idempotency-Key": message.getId() },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
  } catch (e) {
    console.error("Red: " + e); // sin datos del correo en los logs
    return "retry";
  }
  var code = res.getResponseCode();
  if (code >= 200 && code < 300) return "ok"; // 200/201/202: registrado, duplicado, revisión o ignorado
  if (code === 429 || code >= 500) return "retry";
  console.error("Ciclo respondió " + code + " (mensaje " + message.getId() + ")");
  return "fail"; // 400/401/403/409/413…: reintentar no ayuda; revisa la etiqueta ciclo/error
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/** Ejecútala una vez a mano: crea las etiquetas y el activador de cada minuto. */
function install() {
  getOrCreateLabel_(LABEL_SOURCE);
  getOrCreateLabel_(LABEL_DONE);
  getOrCreateLabel_(LABEL_ERROR);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "processBankEmails") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("processBankEmails").timeBased().everyMinutes(1).create();
}

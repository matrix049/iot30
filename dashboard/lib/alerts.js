/**
 * Smart School IoT - Threshold-based alerts
 * Vérifie chaque mesure entrante contre des seuils configurables et émet des alertes.
 */

let thresholds = {
  temperature: { min: 16, max: 28 },        // °C
  humidity:    { min: 20, max: 80 },        // %
  air_ppm:     { max: 1500 },               // ppm CO2
  sound:       { max: 80 },                 // % (proxy dB)
  light:       { min: 10 },                 // % (trop sombre)
};

// Tracks currently-active alerts keyed by `${classroom}:${sensor}`.
// Used to detect transitions back to normal so we can auto-clear.
const activeAlerts = {};

/**
 * Returns { triggered: [...], cleared: [...] }.
 *   triggered: new alerts to record/emit
 *   cleared:   alerts that were active but the value is back in range
 *
 * Alert shape: { classroom, sensor, level, message }
 *   level: "INFO" | "WARNING" | "CRITICAL"
 */
function check(classroom, sensor, payload) {
  const triggered = [];
  const cleared   = [];
  const key = `${classroom}:${sensor}`;
  let alert = null;

  switch (sensor) {
    case "temperature": {
      const v = num(payload.value);
      if (v === null) break;
      if (v > thresholds.temperature.max)
        alert = mkAlert(classroom, sensor, "WARNING", `Température élevée : ${v.toFixed(1)}°C (seuil ${thresholds.temperature.max}°C)`);
      else if (v < thresholds.temperature.min)
        alert = mkAlert(classroom, sensor, "WARNING", `Température basse : ${v.toFixed(1)}°C (seuil ${thresholds.temperature.min}°C)`);
      break;
    }
    case "humidity": {
      const v = num(payload.value);
      if (v === null) break;
      if (v > thresholds.humidity.max)
        alert = mkAlert(classroom, sensor, "INFO", `Humidité haute : ${v.toFixed(1)}% (seuil ${thresholds.humidity.max}%)`);
      else if (v < thresholds.humidity.min)
        alert = mkAlert(classroom, sensor, "INFO", `Humidité basse : ${v.toFixed(1)}% (seuil ${thresholds.humidity.min}%)`);
      break;
    }
    case "air_quality": {
      const ppm = num(payload.ppm);
      if (ppm === null) break;
      if (ppm > thresholds.air_ppm.max)
        alert = mkAlert(classroom, sensor, "CRITICAL", `Air dégradé : ${ppm} ppm (${payload.quality || "POOR"}) — seuil ${thresholds.air_ppm.max} ppm`);
      break;
    }
    case "sound": {
      const v = num(payload.percent ?? payload.dB);
      if (v === null) break;
      if (v > thresholds.sound.max)
        alert = mkAlert(classroom, sensor, "WARNING", `Bruit élevé : ${v}% (seuil ${thresholds.sound.max}%)`);
      break;
    }
    case "light": {
      const v = num(payload.percent);
      if (v === null) break;
      if (v < thresholds.light.min)
        alert = mkAlert(classroom, sensor, "INFO", `Luminosité faible : ${v}% (seuil ${thresholds.light.min}%)`);
      break;
    }
  }

  if (alert) {
    // Only emit a new event if the alert is NEW or the message changed
    const prev = activeAlerts[key];
    if (!prev || prev.message !== alert.message) {
      triggered.push(alert);
      activeAlerts[key] = alert;
    }
  } else if (activeAlerts[key]) {
    // Value back to normal — auto-clear the previously-active alert
    const prev = activeAlerts[key];
    cleared.push({ classroom, sensor, level: prev.level, message: `Retour à la normale (${sensor})` });
    delete activeAlerts[key];
  }

  return { triggered, cleared };
}

function getActiveAlerts() {
  return Object.values(activeAlerts);
}

function clearAllActive() {
  Object.keys(activeAlerts).forEach((k) => delete activeAlerts[k]);
}

function num(x) {
  if (x === undefined || x === null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function mkAlert(classroom, sensor, level, message) {
  return { classroom, sensor, level, message };
}

function getThresholds() { return JSON.parse(JSON.stringify(thresholds)); }

function setThresholds(patch) {
  if (!patch || typeof patch !== "object") return getThresholds();
  for (const [k, v] of Object.entries(patch)) {
    if (thresholds[k] && v && typeof v === "object") {
      thresholds[k] = { ...thresholds[k], ...v };
    }
  }
  return getThresholds();
}

module.exports = { check, getThresholds, setThresholds, getActiveAlerts, clearAllActive };

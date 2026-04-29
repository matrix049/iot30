/**
 * Smart School IoT - Local persistence
 * Stockage JSON local pour l'historique des lectures et des alertes.
 * Le schéma reste compatible avec une base SQL (champs id implicite, ts, sensor, value).
 */

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "history.json");
const FLUSH_INTERVAL_MS = 10000;
const MAX_READINGS_PER_CLASSROOM = 500;
const MAX_ALERTS = 200;

let store = { classrooms: {}, alerts: [] };

function load() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") store = { ...store, ...parsed };
      console.log(`[STORE] Loaded ${Object.keys(store.classrooms).length} classrooms, ${store.alerts.length} alerts from ${DB_PATH}`);
    } else {
      console.log("[STORE] No history file yet — starting fresh");
    }
  } catch (err) {
    console.error("[STORE] load failed:", err.message);
  }
}

function flush() {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(store));
  } catch (err) {
    console.error("[STORE] flush failed:", err.message);
  }
}

function recordReading(classroom, sensor, value) {
  if (value === undefined || value === null || Number.isNaN(value)) return;
  if (!store.classrooms[classroom]) store.classrooms[classroom] = [];
  const arr = store.classrooms[classroom];
  arr.push({ sensor, value, ts: Date.now() });
  if (arr.length > MAX_READINGS_PER_CLASSROOM) arr.shift();
}

function getHistory(classroom, sensor, limit = 50) {
  const arr = store.classrooms[classroom] || [];
  const filtered = sensor ? arr.filter((r) => r.sensor === sensor) : arr;
  const lim = Math.min(Math.max(parseInt(limit) || 50, 1), MAX_READINGS_PER_CLASSROOM);
  return filtered.slice(-lim);
}

function recordAlert(alert) {
  store.alerts.push({ ...alert, ts: Date.now() });
  if (store.alerts.length > MAX_ALERTS) store.alerts.shift();
}

function getAlerts(limit = 50) {
  const lim = Math.min(Math.max(parseInt(limit) || 50, 1), MAX_ALERTS);
  return store.alerts.slice(-lim).reverse();
}

function summary() {
  return {
    classrooms: Object.fromEntries(
      Object.entries(store.classrooms).map(([id, arr]) => [id, arr.length])
    ),
    alerts: store.alerts.length,
    file: DB_PATH,
  };
}

load();
const flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
flushTimer.unref?.();

process.on("SIGINT", () => { flush(); process.exit(0); });
process.on("SIGTERM", () => { flush(); process.exit(0); });

module.exports = {
  recordReading,
  getHistory,
  recordAlert,
  getAlerts,
  flush,
  summary,
};

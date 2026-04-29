/**
 * Smart School IoT - Dashboard Backend
 * Node.js + Express + MQTT
 * Run: npm install && node server.js
 */

const express    = require("express");
const http       = require("http");
const mqtt       = require("mqtt");
const { Server } = require("socket.io");
const path       = require("path");
const store      = require("./lib/store");
const alertsLib  = require("./lib/alerts");
const simulator  = require("./lib/simulator");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── MQTT Config ─────────────────────────────────────────────────────────
const BROKER     = "mqtt://broker.hivemq.com:1883";  // fallback: mqtt://test.mosquitto.org:1883
const CLIENT_ID  = "SmartSchool_Dashboard_" + Math.random().toString(16).substr(2, 8);

const TOPICS = [
  "smartschool/+/temperature",
  "smartschool/+/humidity",
  "smartschool/+/motion",
  "smartschool/+/light",
  "smartschool/+/sound",
  "smartschool/+/air_quality",
  "smartschool/+/presence",
  "smartschool/+/lock",
  "smartschool/+/status",
];

// ─── In-memory state ──────────────────────────────────────────────────────
const classroomState = {};

function getOrCreate(classroom) {
  if (!classroomState[classroom]) {
    classroomState[classroom] = {
      id: classroom,
      temperature: null,
      humidity: null,
      motion: false,
      light: null,
      sound: null,
      air_quality: null,
      presence: 0,
      locked: false,
      online: false,
      lastUpdate: null,
    };
  }
  return classroomState[classroom];
}

// ─── Connect to MQTT broker ───────────────────────────────────────────────
console.log(`Connecting to MQTT broker: ${BROKER}`);
const mqttClient = mqtt.connect(BROKER, {
  clientId: CLIENT_ID,
  clean: true,
  reconnectPeriod: 3000,
});

mqttClient.on("connect", () => {
  console.log("✓ MQTT connected");
  TOPICS.forEach((t) => mqttClient.subscribe(t, { qos: 0 }));
  simulator.start(mqttClient);
});

mqttClient.on("error", (err) => console.error("MQTT error:", err.message));

mqttClient.on("message", (topic, payloadBuf) => {
  let payload;
  try {
    payload = JSON.parse(payloadBuf.toString());
  } catch {
    payload = { raw: payloadBuf.toString() };
  }

  // Extract classroom from topic: smartschool/classroom1/sensor
  const parts = topic.split("/");
  const classroom = parts[1];
  const sensor    = parts[2];
  const state     = getOrCreate(classroom);

  // Track value to record in history (single numeric where possible)
  let historyValue = null;

  switch (sensor) {
    case "temperature": state.temperature = payload.value;   historyValue = payload.value;   break;
    case "humidity":    state.humidity    = payload.value;   historyValue = payload.value;   break;
    case "motion":      state.motion      = payload.motion;  historyValue = payload.motion ? 1 : 0; break;
    case "light":       state.light       = payload.percent; historyValue = payload.percent; break;
    case "sound":       state.sound       = payload.percent !== undefined ? payload.percent : payload.dB !== undefined ? payload.dB : payload.raw !== undefined ? Math.round(Number(payload.raw) / 40.95) : null; historyValue = state.sound; break;
    case "air_quality": state.air_quality = { ppm: payload.ppm, quality: payload.quality }; historyValue = payload.ppm; break;
    case "presence":    state.presence    = payload.count;   historyValue = payload.count;   break;
    case "lock":        state.locked      = payload.locked;  break;
    case "status":      state.online      = payload.status === "online"; break;
  }
  state.lastUpdate = new Date().toISOString();

  // Persist reading
  if (historyValue !== null && historyValue !== undefined) {
    store.recordReading(classroom, sensor, historyValue);
  }

  // Threshold check → emit alerts (and auto-clear when value back to normal)
  const { triggered, cleared } = alertsLib.check(classroom, sensor, payload);
  triggered.forEach((a) => {
    store.recordAlert(a);
    io.emit("alert", a);
    console.log(`[ALERT ${a.level}] ${a.classroom} ${a.sensor} — ${a.message}`);
  });
  cleared.forEach((c) => {
    io.emit("alert_cleared", c);
    console.log(`[ALERT CLEARED] ${c.classroom} ${c.sensor}`);
  });

  // Forward to dashboard via WebSocket
  io.emit("sensor_update", { classroom, sensor, data: payload, state });
});

// ─── REST API ─────────────────────────────────────────────────────────────
app.get("/api/classrooms", (req, res) => {
  res.json(Object.values(classroomState));
});

app.get("/api/classrooms/:id", (req, res) => {
  const state = classroomState[req.params.id];
  if (!state) return res.status(404).json({ error: "Classroom not found" });
  res.json(state);
});

// Lock / Unlock command
app.post("/api/classrooms/:id/lock", (req, res) => {
  const { lock } = req.body;
  const id = req.params.id;
  const topic = `smartschool/${id}/cmd/lock`;
  mqttClient.publish(topic, JSON.stringify({ lock: !!lock }));
  console.log(`[CMD OUT] ${topic} → {"lock":${!!lock}}`);
  // Simulated rooms have no ESP32 to react — update their state directly
  if (simulator.handleLockCommand(mqttClient, id, !!lock)) {
    console.log(`[SIM] Lock state for ${id} updated to ${lock}`);
  }
  res.json({ success: true, lock: !!lock });
});

// Trigger alarm (LED blink sequence on the ESP32)
app.post("/api/classrooms/:id/alarm", (req, res) => {
  const topic = `smartschool/${req.params.id}/cmd/alarm`;
  mqttClient.publish(topic, JSON.stringify({ trigger: true }));
  console.log(`[CMD OUT] ${topic} → {"trigger":true}`);
  res.json({ success: true });
});

// Sensor history for a classroom
//   GET /api/classrooms/:id/history?sensor=temperature&limit=50
app.get("/api/classrooms/:id/history", (req, res) => {
  const sensor = req.query.sensor;
  const limit  = req.query.limit;
  res.json(store.getHistory(req.params.id, sensor, limit));
});

// Alerts log (history of triggered alerts)
app.get("/api/alerts", (req, res) => {
  res.json(store.getAlerts(req.query.limit));
});

// Currently-active alerts (auto-cleared when value back to normal)
app.get("/api/alerts/active", (req, res) => {
  res.json(alertsLib.getActiveAlerts());
});

// Threshold configuration
app.get("/api/thresholds", (req, res) => {
  res.json(alertsLib.getThresholds());
});

app.put("/api/thresholds", (req, res) => {
  const updated = alertsLib.setThresholds(req.body);
  console.log("[THRESHOLDS UPDATED]", JSON.stringify(updated));
  res.json(updated);
});

// Storage health (handy for the demo)
app.get("/api/storage", (req, res) => {
  res.json(store.summary());
});

// Run scripted demo sequence (showcases alerts + recovery)
app.post("/api/demo/run", (req, res) => {
  simulator.runDemo(mqttClient);
  res.json({ success: true, duration_s: 25 });
});

// ─── WebSocket ───────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("Dashboard client connected:", socket.id);
  // Send full state on connect
  socket.emit("full_state", classroomState);
  // Send currently-active alerts (auto-cleared when value normalises)
  socket.emit("active_alerts_snapshot", alertsLib.getActiveAlerts());
});

// ─── Start server ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✓ Dashboard running at http://localhost:${PORT}`);
});

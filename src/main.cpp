// ════════════════════════════════════════════════════════════════════
//  Smart School IoT - ESP32 Firmware (autonomous + IoT)
// ────────────────────────────────────────────────────────────────────
//  - Reads 7 sensors (DHT22, PIR, LDR, sound, MQ-135, IR, relay)
//  - Reacts AUTONOMOUSLY with on-board rules:
//      • Auto-lights when dark + motion (LED_MOTION on for 30 s)
//      • Auto-lock + alarm on intrusion (very dark + motion)
//      • Emergency alarm on bad air (CO2 > 1500 ppm)
//      • Climate emergency on extreme temp (> 32 °C)
//      • Overcrowding warning (relay click) when presence > 30
//  - Publishes telemetry to MQTT for the dashboard (when connected)
//  - Receives lock/alarm commands from the dashboard
//  - WiFi/MQTT use NON-BLOCKING reconnection so loop() never freezes
// ════════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>

// ─── Network Config ──────────────────────────────────────────────────
const char* WIFI_SSID      = "Wokwi-GUEST";
const char* WIFI_PASSWORD  = "";
const char* MQTT_SERVER    = "broker.hivemq.com";  // fallback: test.mosquitto.org
const int   MQTT_PORT      = 1883;
const char* MQTT_CLIENT_ID = "SmartSchool_ESP32";

// ─── MQTT Topics ────────────────────────────────────────────────────
const char* T_TEMP      = "smartschool/classroom1/temperature";
const char* T_HUM       = "smartschool/classroom1/humidity";
const char* T_MOTION    = "smartschool/classroom1/motion";
const char* T_LIGHT     = "smartschool/classroom1/light";
const char* T_SOUND     = "smartschool/classroom1/sound";
const char* T_AIR       = "smartschool/classroom1/air_quality";
const char* T_PRESENCE  = "smartschool/classroom1/presence";
const char* T_LOCK      = "smartschool/classroom1/lock";
const char* T_STATUS    = "smartschool/classroom1/status";
const char* T_CMD_LOCK  = "smartschool/classroom1/cmd/lock";
const char* T_CMD_ALARM = "smartschool/classroom1/cmd/alarm";

// ─── Pin Definitions ────────────────────────────────────────────────
#define DHT_PIN     15
#define DHT_TYPE    DHT22
#define PIR_PIN     14
#define LDR_PIN     34
#define SOUND_PIN   35
#define MQ135_PIN   32
#define IR_PIN      27
#define LOCK_PIN    26
#define LED_WIFI     2   // green: system / WiFi+MQTT status
#define LED_LOCK     4   // red:   lock state / alarm
#define LED_MOTION   5   // yellow: occupancy / auto-lights

// ─── Globals ─────────────────────────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);
WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);

bool lockState     = false;
bool motionState   = false;
int  presenceCount = 0;
String lastAirQuality = "GOOD";

// 5-point moving average filters for noisy analog inputs
const int FILTER_SIZE = 5;
int  soundBuf[FILTER_SIZE] = {0};
int  airBuf[FILTER_SIZE]   = {0};
int  soundIdx = 0, airIdx = 0;
bool soundFilled = false, airFilled = false;

// Timers
unsigned long lastPublish        = 0;
unsigned long lastHeartbeat      = 0;
unsigned long lastWifiRetry      = 0;
unsigned long lastMqttRetry      = 0;
unsigned long autoLightUntil     = 0;
unsigned long lastEmergencyAir   = 0;
unsigned long lastEmergencyTemp  = 0;
int           lastNotifiedCrowd  = 0;

const unsigned long PUBLISH_INTERVAL    = 3000;
const unsigned long HEARTBEAT_INTERVAL  = 30000;
const unsigned long WIFI_RETRY_MS       = 5000;
const unsigned long MQTT_RETRY_MS       = 4000;
const unsigned long AUTO_LIGHT_DURATION = 30000;
const unsigned long ALARM_THROTTLE_MS   = 10000;

// ─── Forward Declarations ───────────────────────────────────────────
void selfTest();
void updateNetworkLED();
void connectMqttNonBlocking();
void readMotion();
void publishSensors();
void runAutonomousRules(int lightPct, int airPPM, float temp, int soundLvl);
int  movingAvg(int* buf, int& idx, bool& filled, int v);
void mqttCallback(char* topic, byte* payload, unsigned int length);
bool parseLockPayload(const String& msg);
void updateLock(bool locked);
void triggerAlarm();
void publishHeartbeat();

// ════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n╔══════════════════════════════════════╗");
  Serial.println("║  Smart School IoT — ESP32 v3 autonomous  ║");
  Serial.println("╚══════════════════════════════════════╝");

  pinMode(PIR_PIN,    INPUT);
  pinMode(IR_PIN,     INPUT_PULLUP);
  pinMode(LOCK_PIN,   OUTPUT);
  pinMode(LED_WIFI,   OUTPUT);
  pinMode(LED_LOCK,   OUTPUT);
  pinMode(LED_MOTION, OUTPUT);

  digitalWrite(LOCK_PIN,   LOW);
  digitalWrite(LED_WIFI,   LOW);
  digitalWrite(LED_LOCK,   LOW);
  digitalWrite(LED_MOTION, LOW);

  selfTest();

  dht.begin();

  // Kick off WiFi without blocking — loop() will retry as needed
  Serial.printf("[WIFI] Starting connection to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiRetry = millis();

  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);

  Serial.println("[BOOT] Setup complete — entering loop");
}

// ════════════════════════════════════════════════════════════════════
void loop() {
  updateNetworkLED();

  // Non-blocking MQTT reconnect
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected()
      && millis() - lastMqttRetry > MQTT_RETRY_MS) {
    lastMqttRetry = millis();
    connectMqttNonBlocking();
  }

  if (mqtt.connected()) mqtt.loop();

  // Always read motion (autonomous logic doesn't need WiFi)
  readMotion();

  // Periodic sensor publish + autonomous rules
  if (millis() - lastPublish >= PUBLISH_INTERVAL) {
    lastPublish = millis();
    publishSensors();
  }

  // Periodic heartbeat (only if MQTT up)
  if (mqtt.connected() && millis() - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = millis();
    publishHeartbeat();
  }

  // Auto-lights timer: keep LED_MOTION on while window active
  if (millis() < autoLightUntil) {
    digitalWrite(LED_MOTION, HIGH);
  } else if (!motionState) {
    digitalWrite(LED_MOTION, LOW);
  }
}

// ════════════════════════════════════════════════════════════════════
// Self-test sequence — proves wiring + firmware load.
// Very obvious: 5 seconds of LEDs with long ON/OFF cycles.
void selfTest() {
  Serial.println("[BOOT] === SELF TEST START ===");
  // 5 long blinks of the RED LED only — impossible to miss
  for (int n = 0; n < 5; n++) {
    digitalWrite(LED_LOCK, HIGH);
    Serial.println("[TEST] RED ON");
    delay(500);
    digitalWrite(LED_LOCK, LOW);
    Serial.println("[TEST] RED OFF");
    delay(300);
  }
  // Then yellow
  for (int n = 0; n < 3; n++) {
    digitalWrite(LED_MOTION, HIGH); delay(400);
    digitalWrite(LED_MOTION, LOW);  delay(200);
  }
  // Then green
  for (int n = 0; n < 3; n++) {
    digitalWrite(LED_WIFI, HIGH); delay(400);
    digitalWrite(LED_WIFI, LOW);  delay(200);
  }
  // Relay click test
  digitalWrite(LOCK_PIN, HIGH); delay(300);
  digitalWrite(LOCK_PIN, LOW);
  Serial.println("[BOOT] === SELF TEST DONE ===");
}

// ════════════════════════════════════════════════════════════════════
// Visual network status on the green LED:
//   off       = WiFi not connected
//   blink fast = WiFi OK, MQTT not connected
//   solid ON  = WiFi + MQTT both connected
void updateNetworkLED() {
  bool wifiOK = WiFi.status() == WL_CONNECTED;
  bool mqttOK = mqtt.connected();

  if (!wifiOK) {
    digitalWrite(LED_WIFI, LOW);
    if (millis() - lastWifiRetry > WIFI_RETRY_MS) {
      lastWifiRetry = millis();
      Serial.println("[WIFI] retry");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  } else if (!mqttOK) {
    digitalWrite(LED_WIFI, (millis() / 200) % 2);  // fast blink
  } else {
    digitalWrite(LED_WIFI, HIGH);
  }
}

// ════════════════════════════════════════════════════════════════════
void connectMqttNonBlocking() {
  Serial.printf("[MQTT] connecting to %s ... ", MQTT_SERVER);
  if (mqtt.connect(MQTT_CLIENT_ID)) {
    Serial.println("✓");
    mqtt.subscribe(T_CMD_LOCK);
    mqtt.subscribe(T_CMD_ALARM);
    Serial.printf("[SUB] %s\n[SUB] %s\n", T_CMD_LOCK, T_CMD_ALARM);
    publishHeartbeat();
  } else {
    Serial.printf("✗ rc=%d (will retry)\n", mqtt.state());
  }
}

void publishHeartbeat() {
  StaticJsonDocument<160> doc;
  doc["device"]    = "ESP32_SmartSchool";
  doc["classroom"] = "1";
  doc["status"]    = "online";
  doc["uptime_s"]  = millis() / 1000;
  doc["ip"]        = WiFi.localIP().toString();
  char buf[160];
  serializeJson(doc, buf);
  mqtt.publish(T_STATUS, buf, true);
  Serial.printf("[HEARTBEAT] uptime=%lus\n", millis() / 1000);
}

// ════════════════════════════════════════════════════════════════════
void readMotion() {
  bool newMotion = digitalRead(PIR_PIN);
  if (newMotion == motionState) return;

  motionState = newMotion;

  if (motionState) {
    digitalWrite(LED_MOTION, HIGH);
    presenceCount++;
    Serial.printf("[MOTION] DETECTED (count=%d)\n", presenceCount);

    int rawL = analogRead(LDR_PIN);
    int lightPct = map(rawL, 0, 4095, 0, 100);

    // Rule: auto-lights when dark + motion
    if (lightPct < 30) {
      autoLightUntil = millis() + AUTO_LIGHT_DURATION;
      Serial.printf("[AUTO-LIGHT] ON for %lus (light=%d%%)\n",
                    AUTO_LIGHT_DURATION / 1000, lightPct);
    }

    // Rule: very dark + motion = intrusion → auto-lock + alarm
    if (lightPct < 10 && !lockState) {
      Serial.println("[INTRUSION] dark + motion → auto-lock + alarm");
      updateLock(true);
      triggerAlarm();
    }

    if (mqtt.connected()) {
      StaticJsonDocument<96> p;
      p["detected"]  = true;
      p["count"]     = presenceCount;
      p["classroom"] = "1";
      char buf[96];
      serializeJson(p, buf);
      mqtt.publish(T_PRESENCE, buf);
    }
  } else {
    if (millis() >= autoLightUntil) digitalWrite(LED_MOTION, LOW);
  }

  if (mqtt.connected()) {
    StaticJsonDocument<64> doc;
    doc["motion"]    = motionState;
    doc["classroom"] = "1";
    char buf[64];
    serializeJson(doc, buf);
    mqtt.publish(T_MOTION, buf, true);
  }
}

// ════════════════════════════════════════════════════════════════════
void publishSensors() {
  // ── DHT22 ──
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();
  if (isnan(temp)) temp = 0;
  if (isnan(hum))  hum  = 0;

  // ── LDR ──
  int rawL = analogRead(LDR_PIN);
  int lightPct = map(rawL, 0, 4095, 0, 100);

  // ── Sound (filtered) ──
  int rawS    = analogRead(SOUND_PIN);
  int smoothS = movingAvg(soundBuf, soundIdx, soundFilled, rawS);
  int soundLvl = map(smoothS, 0, 4095, 0, 100);

  // ── MQ-135 (filtered) ──
  int rawA    = analogRead(MQ135_PIN);
  int smoothA = movingAvg(airBuf, airIdx, airFilled, rawA);
  int airPPM  = map(smoothA, 0, 4095, 400, 5000);
  String airQuality = airPPM < 800 ? "GOOD" : airPPM < 1500 ? "MODERATE" : "POOR";

  Serial.printf("[READ] T=%.1f°C H=%.0f%% L=%d%% S=%d%% PPM=%d (%s) Pres=%d Lock=%d\n",
                temp, hum, lightPct, soundLvl, airPPM, airQuality.c_str(),
                presenceCount, lockState);

  // ── Run autonomous rules (LOCAL hardware actions, no MQTT needed) ──
  runAutonomousRules(lightPct, airPPM, temp, soundLvl);

  // Auto-trigger alarm when air goes POOR (safety reaction)
  if (airQuality == "POOR" && lastAirQuality != "POOR"
      && millis() - lastEmergencyAir > ALARM_THROTTLE_MS) {
    Serial.println("[SAFETY] Air quality dropped to POOR → auto-alarm");
    lastEmergencyAir = millis();
    triggerAlarm();
  }
  lastAirQuality = airQuality;

  // ── Publish to MQTT (only if connected — fail silently otherwise) ──
  if (!mqtt.connected()) return;

  StaticJsonDocument<160> doc;
  char buf[160];

  if (temp > 0) {
    doc.clear();
    doc["value"] = temp; doc["unit"] = "°C"; doc["classroom"] = "1";
    serializeJson(doc, buf); mqtt.publish(T_TEMP, buf);
  }
  if (hum > 0) {
    doc.clear();
    doc["value"] = hum; doc["unit"] = "%"; doc["classroom"] = "1";
    serializeJson(doc, buf); mqtt.publish(T_HUM, buf);
  }
  doc.clear();
  doc["raw"] = rawL; doc["percent"] = lightPct; doc["classroom"] = "1";
  serializeJson(doc, buf); mqtt.publish(T_LIGHT, buf);

  doc.clear();
  doc["raw"] = rawS; doc["filtered"] = smoothS; doc["percent"] = soundLvl; doc["dB"] = soundLvl; doc["classroom"] = "1";
  serializeJson(doc, buf); mqtt.publish(T_SOUND, buf);

  doc.clear();
  doc["ppm"] = airPPM; doc["quality"] = airQuality; doc["classroom"] = "1";
  serializeJson(doc, buf); mqtt.publish(T_AIR, buf);

  doc.clear();
  doc["count"] = presenceCount; doc["detected"] = motionState; doc["classroom"] = "1";
  serializeJson(doc, buf); mqtt.publish(T_PRESENCE, buf);

  doc.clear();
  doc["locked"] = lockState; doc["classroom"] = "1";
  serializeJson(doc, buf); mqtt.publish(T_LOCK, buf, true);
}

// ════════════════════════════════════════════════════════════════════
// Local autonomous rules — fire even without MQTT/WiFi
void runAutonomousRules(int lightPct, int airPPM, float temp, int soundLvl) {
  // Rule: extreme heat emergency
  if (temp > 32.0 && millis() - lastEmergencyTemp > ALARM_THROTTLE_MS) {
    lastEmergencyTemp = millis();
    Serial.printf("[CLIMATE] Extreme temp %.1f°C → emergency alarm\n", temp);
    triggerAlarm();
  }
  // Rule: overcrowding (>30 students) → relay double-click as audible warning
  if (presenceCount >= 30 && presenceCount != lastNotifiedCrowd) {
    lastNotifiedCrowd = presenceCount;
    Serial.printf("[CROWD] %d students — over capacity\n", presenceCount);
    digitalWrite(LOCK_PIN, HIGH); delay(80);
    digitalWrite(LOCK_PIN, lockState ? HIGH : LOW); delay(80);
    digitalWrite(LOCK_PIN, HIGH); delay(80);
    digitalWrite(LOCK_PIN, lockState ? HIGH : LOW);
  }
}

// ════════════════════════════════════════════════════════════════════
int movingAvg(int* buf, int& idx, bool& filled, int v) {
  buf[idx] = v;
  idx = (idx + 1) % FILTER_SIZE;
  if (idx == 0) filled = true;
  int n = filled ? FILTER_SIZE : (idx == 0 ? FILTER_SIZE : idx);
  long s = 0;
  for (int i = 0; i < n; i++) s += buf[i];
  return (int)(s / n);
}

// ════════════════════════════════════════════════════════════════════
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];

  Serial.println();
  Serial.println("══════════════════════════════════════════");
  Serial.printf("[MQTT IN] Topic   : %s\n", topic);
  Serial.printf("[MQTT IN] Payload : %s\n", message.c_str());
  Serial.println("══════════════════════════════════════════");

  String t(topic);
  if (t == T_CMD_LOCK) {
    bool cmd = parseLockPayload(message);
    Serial.printf("[ACTION] Lock command -> %s\n", cmd ? "LOCK" : "UNLOCK");
    updateLock(cmd);
  } else if (t == T_CMD_ALARM) {
    Serial.println("[ACTION] Alarm command");
    triggerAlarm();
  } else {
    Serial.println("[WARN] Unknown topic");
  }
}

// Accepts JSON {"lock":true} OR plain text "ON"/"OFF"/"TOGGLE"/"1"/"0"
bool parseLockPayload(const String& msg) {
  StaticJsonDocument<64> doc;
  if (deserializeJson(doc, msg) == DeserializationError::Ok && doc.containsKey("lock")) {
    return doc["lock"].as<bool>();
  }
  String s = msg; s.trim(); s.toLowerCase();
  if (s == "on" || s == "true" || s == "1" || s == "lock")    return true;
  if (s == "off" || s == "false" || s == "0" || s == "unlock") return false;
  if (s == "toggle") return !lockState;
  return lockState;
}

void updateLock(bool locked) {
  // 2 quick blinks before settling on the new state
  for (int i = 0; i < 2; i++) {
    digitalWrite(LED_LOCK, HIGH); delay(80);
    digitalWrite(LED_LOCK, LOW);  delay(80);
  }
  lockState = locked;
  digitalWrite(LOCK_PIN, locked ? HIGH : LOW);
  digitalWrite(LED_LOCK, locked ? HIGH : LOW);
  Serial.printf("[LOCK] Door is now %s  (Relay=%d, LED=%d)\n",
                locked ? "LOCKED" : "UNLOCKED",
                locked ? HIGH : LOW, locked ? HIGH : LOW);

  if (mqtt.connected()) {
    StaticJsonDocument<64> doc;
    doc["locked"]    = lockState;
    doc["classroom"] = "1";
    char buf[64];
    serializeJson(doc, buf);
    mqtt.publish(T_LOCK, buf, true);
  }
}

// Visual alarm: red↔yellow alternation, 6 cycles ≈ 3 s
void triggerAlarm() {
  Serial.println("[ALARM] >>> ON <<<");
  for (int i = 0; i < 6; i++) {
    digitalWrite(LED_LOCK,   HIGH); digitalWrite(LED_MOTION, LOW);  delay(250);
    digitalWrite(LED_LOCK,   LOW);  digitalWrite(LED_MOTION, HIGH); delay(250);
  }
  digitalWrite(LED_LOCK,   lockState   ? HIGH : LOW);
  digitalWrite(LED_MOTION, motionState ? HIGH : LOW);
  Serial.println("[ALARM] <<< sequence complete");
}

/**
 * Smart School IoT - Demo simulator
 * Publishes synthetic MQTT data for additional classrooms
 * (classroom2/3/4) so the dashboard shows a full establishment.
 *
 * The real ESP32 keeps publishing for classroom1 — these are
 * extra "virtual" rooms.  Disable with env var DEMO_SIM=0.
 */

const ROOMS = [
  { id: "classroom2", baseTemp: 25.5, baseHum: 60, baseAir: 1100, baseLight: 65, baseSound: 70, presence: 18 },
  { id: "classroom3", baseTemp: 21.5, baseHum: 55, baseAir: 700,  baseLight: 80, baseSound: 55, presence: 27 },
  { id: "classroom4", baseTemp: 28.5, baseHum: 70, baseAir: 1700, baseLight: 45, baseSound: 85, presence: 12 },
];

function jitter(base, range) {
  return Math.round((base + (Math.random() - 0.5) * range) * 10) / 10;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function start(mqttClient) {
  if (process.env.DEMO_SIM === "0") {
    console.log("[SIM] Demo simulator disabled (DEMO_SIM=0)");
    return;
  }

  console.log("[SIM] Starting demo simulator for classroom2/3/4");

  // Initial online status
  ROOMS.forEach((r) => {
    mqttClient.publish(
      `smartschool/${r.id}/status`,
      JSON.stringify({
        device:    "ESP32_Sim_" + r.id,
        classroom: r.id.replace("classroom", ""),
        status:    "online",
        ip:        "10.13.37." + Math.floor(Math.random() * 200),
      }),
      { retain: true }
    );
    // Initial lock state
    mqttClient.publish(
      `smartschool/${r.id}/lock`,
      JSON.stringify({ locked: false, classroom: r.id.replace("classroom", "") }),
      { retain: true }
    );
  });

  // Periodic sensor readings (every 3 s)
  setInterval(() => {
    ROOMS.forEach((r) => {
      const cls = r.id.replace("classroom", "");
      const temp  = jitter(r.baseTemp, 1.5);
      const hum   = jitter(r.baseHum, 4);
      const light = clamp(jitter(r.baseLight, 8), 0, 100);
      const sound = clamp(jitter(r.baseSound, 6), 0, 100);
      const ppm   = clamp(jitter(r.baseAir, 150), 400, 4500);
      const quality = ppm < 800 ? "GOOD" : ppm < 1500 ? "MODERATE" : "POOR";

      const pub = (suffix, body) =>
        mqttClient.publish(`smartschool/${r.id}/${suffix}`, JSON.stringify({ ...body, classroom: cls }));

      pub("temperature", { value: temp,  unit: "°C" });
      pub("humidity",    { value: hum,   unit: "%"  });
      pub("light",       { percent: Math.round(light) });
      pub("sound",       { percent: Math.round(sound), dB: Math.round(sound) });
      pub("air_quality", { ppm: Math.round(ppm), quality });
      pub("presence",    { count: r.presence, detected: false });
    });
  }, 3000);

  // Heartbeat (every 30 s)
  setInterval(() => {
    ROOMS.forEach((r) => {
      mqttClient.publish(
        `smartschool/${r.id}/status`,
        JSON.stringify({
          device:    "ESP32_Sim_" + r.id,
          classroom: r.id.replace("classroom", ""),
          status:    "online",
          uptime_s:  Math.floor(process.uptime()),
        }),
        { retain: true }
      );
    });
  }, 30000);

  // Random presence increments — students arriving here and there
  setInterval(() => {
    const r = ROOMS[Math.floor(Math.random() * ROOMS.length)];
    r.presence++;
    mqttClient.publish(
      `smartschool/${r.id}/presence`,
      JSON.stringify({
        count:     r.presence,
        detected:  true,
        classroom: r.id.replace("classroom", ""),
      })
    );
  }, 8000);

  // Occasional motion event in a random room
  setInterval(() => {
    const r = ROOMS[Math.floor(Math.random() * ROOMS.length)];
    mqttClient.publish(
      `smartschool/${r.id}/motion`,
      JSON.stringify({ motion: true, classroom: r.id.replace("classroom", "") }),
      { retain: true }
    );
    setTimeout(() => {
      mqttClient.publish(
        `smartschool/${r.id}/motion`,
        JSON.stringify({ motion: false, classroom: r.id.replace("classroom", "") }),
        { retain: true }
      );
    }, 4000);
  }, 12000);
}

// Allow the dashboard to handle simulated lock commands too
function handleLockCommand(mqttClient, classroom, locked) {
  const r = ROOMS.find((x) => x.id === classroom);
  if (!r) return false;
  mqttClient.publish(
    `smartschool/${classroom}/lock`,
    JSON.stringify({ locked: !!locked, classroom: classroom.replace("classroom", "") }),
    { retain: true }
  );
  return true;
}

/**
 * Run a scripted demo: cycles through scenarios on classroom2/3/4
 * to showcase alerts and recovery in ~25 seconds.
 */
function runDemo(mqttClient) {
  console.log("[DEMO] Starting scripted demo sequence");

  const r4 = ROOMS.find((r) => r.id === "classroom4");
  const r2 = ROOMS.find((r) => r.id === "classroom2");

  if (!r4 || !r2) return;

  // Save originals
  const orig4 = { ...r4 };
  const orig2 = { ...r2 };

  // Step 1: spike classroom4 air to CRITICAL
  setTimeout(() => {
    console.log("[DEMO] step 1/5 — classroom4 air → CRITICAL (1900 ppm)");
    r4.baseAir = 1900;
    r4.baseTemp = 31;
  }, 500);

  // Step 2: spike classroom2 sound
  setTimeout(() => {
    console.log("[DEMO] step 2/5 — classroom2 sound → 90%");
    r2.baseSound = 90;
  }, 5000);

  // Step 3: classroom4 lock
  setTimeout(() => {
    console.log("[DEMO] step 3/5 — classroom4 auto-lock");
    mqttClient.publish(
      `smartschool/classroom4/lock`,
      JSON.stringify({ locked: true, classroom: "4" }),
      { retain: true }
    );
  }, 10000);

  // Step 4: classroom2 sound returns to normal (alert auto-clears)
  setTimeout(() => {
    console.log("[DEMO] step 4/5 — classroom2 sound back to normal");
    r2.baseSound = orig2.baseSound;
  }, 15000);

  // Step 5: full recovery
  setTimeout(() => {
    console.log("[DEMO] step 5/5 — classroom4 returns to normal, unlocking");
    r4.baseAir = orig4.baseAir;
    r4.baseTemp = orig4.baseTemp;
    mqttClient.publish(
      `smartschool/classroom4/lock`,
      JSON.stringify({ locked: false, classroom: "4" }),
      { retain: true }
    );
    console.log("[DEMO] sequence complete");
  }, 22000);
}

module.exports = { start, handleLockCommand, runDemo, ROOM_IDS: ROOMS.map((r) => r.id) };

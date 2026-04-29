# Smart School IoT

Système de surveillance intelligent pour établissements scolaires.
Architecture IoT complète : **ESP32 (simulé sur Wokwi) → MQTT → Node.js → Dashboard Web temps réel**.

---

## Aperçu

- Lecture continue de 7 capteurs (température, humidité, mouvement, luminosité, bruit, qualité de l'air, présence)
- Contrôle à distance d'un actionneur (relais / serrure)
- **Règles autonomes** sur l'ESP32 : auto-éclairage, anti-intrusion, alerte qualité d'air, urgence climatique, sur-capacité
- Dashboard web temps réel (Socket.IO) avec affichage de **4 salles**
- **Alertes par seuils** configurables, avec auto-effacement quand la valeur revient à la normale
- Persistance JSON (lectures et alertes horodatées) — schéma compatible MySQL en production
- API REST + bouton démo intégré

---

## Architecture

```
[Capteurs Wokwi] → [ESP32 GPIO]
                         ↓ Wi-Fi
                    [MQTT Broker]   ← broker.hivemq.com:1883 (public)
                         ↓
                  [Node.js server.js]
                  ├── REST API
                  ├── Socket.IO (WebSocket)
                  └── Stockage local JSON
                         ↓
                  [Dashboard Web]
```

---

## Structure du projet

```
smart_school/
├── src/
│   └── main.cpp              # Firmware ESP32 (autonome + MQTT)
├── dashboard/
│   ├── server.js             # Backend Node.js (Express + MQTT + Socket.IO)
│   ├── lib/
│   │   ├── store.js          # Persistance JSON
│   │   ├── alerts.js         # Logique seuils + auto-clear
│   │   └── simulator.js      # Données simulées pour classroom2/3/4
│   ├── public/
│   │   └── index.html        # Dashboard web
│   └── package.json
├── diagram.json              # Schéma Wokwi (circuit ESP32 + capteurs)
├── platformio.ini            # Configuration PlatformIO
├── wokwi.toml                # Lien Wokwi ↔ PlatformIO
├── start.bat / start.sh      # Lancement rapide du dashboard
├── setup.bat / setup.sh      # Installation tout-en-un des dépendances
├── REQUIREMENTS.md           # Détail des dépendances système et bibliothèques
└── README.md
```

---

## Prérequis

| Outil | Version | Pourquoi |
|---|---|---|
| **Node.js** | ≥ 18 | Backend dashboard |
| **VS Code / Cursor / Kiro** | dernière | IDE |
| Extension **Wokwi for VS Code** | dernière | Simulateur ESP32 |
| Extension **PlatformIO IDE** | dernière | Compilation firmware ESP32 |
| Internet | — | Broker MQTT public |

---

## How to run (étape par étape)

### 1. Cloner le projet

```bash
git clone https://github.com/matrix049/iot30.git
cd iot30
```

### 2. Installer toutes les dépendances en une commande

**Windows :**
```powershell
setup.bat
```

**Linux / macOS :**
```bash
./setup.sh
```

Le script vérifie Node.js, installe les dépendances npm, et compile le firmware ESP32 via PlatformIO. Liste complète des prérequis dans [REQUIREMENTS.md](REQUIREMENTS.md).

> Si PlatformIO n'est pas trouvé : installe l'extension **PlatformIO IDE** dans ton éditeur et relance `setup`, ou compile le firmware manuellement via `PlatformIO: Build`.

### 3. Lancer le dashboard

**Option A — Script**
```bash
./start.sh        # Linux / macOS
start.bat         # Windows
```

**Option B — Manuel**
```bash
cd dashboard && npm start
```

→ Dashboard disponible sur <http://localhost:3000>

### 4. Lancer la simulation Wokwi

Dans l'IDE :
- Ouvrir le fichier `diagram.json`
- `F1` → `Wokwi: Start Simulator`
- Si demandé : `F1` → `Wokwi: Request a New License` (gratuit)

L'ESP32 démarre, fait son self-test (LEDs + relais), se connecte au Wi-Fi `Wokwi-GUEST` puis au broker MQTT.

### 5. Tester

Sur le dashboard tu vois 4 salles :
- **Salle 1** = données réelles de ton ESP32 Wokwi
- **Salles 2, 3, 4** = données simulées côté serveur (pour démontrer la scalabilité multi-salles)

Actions possibles :
- Bouton **▶ Démo** dans le header → séquence orchestrée de 25 s qui montre alertes + auto-recovery
- Bouton **🔓 / 🔒** sur Salle 1 → relais clique dans Wokwi
- Bouton **🔔** sur Salle 1 → séquence d'alarme
- Manipuler les capteurs Wokwi (DHT22, LDR, joystick, MQ-135) → valeurs mises à jour en temps réel
- Clic sur le PIR → mouvement détecté + compteur d'élèves incrémenté
- Modifier les seuils via API :
  ```bash
  curl -X PUT -H "Content-Type: application/json" \
    -d "{\"temperature\":{\"max\":22}}" \
    http://localhost:3000/api/thresholds
  ```

---

## Topics MQTT

```
ESP32 → broker (télémétrie)
  smartschool/classroom1/temperature      {"value":23.4,"unit":"°C"}
  smartschool/classroom1/humidity         {"value":58,"unit":"%"}
  smartschool/classroom1/motion           {"motion":true}
  smartschool/classroom1/light            {"raw":2048,"percent":50}
  smartschool/classroom1/sound            {"raw":2048,"filtered":1850,"percent":45}
  smartschool/classroom1/air_quality      {"ppm":720,"quality":"GOOD"}
  smartschool/classroom1/presence         {"count":24,"detected":true}
  smartschool/classroom1/lock             {"locked":false}
  smartschool/classroom1/status           {"status":"online","uptime_s":1234,"ip":"..."}

broker → ESP32 (commandes)
  smartschool/classroom1/cmd/lock         {"lock":true|false}
  smartschool/classroom1/cmd/alarm        {"trigger":true}
```

---

## Règles autonomes ESP32

L'ESP32 réagit physiquement même sans MQTT/dashboard :

| Règle | Condition | Action |
|---|---|---|
| Auto-éclairage | Lumière < 30% **ET** mouvement | LED jaune ON pendant 30 s |
| Anti-intrusion | Lumière < 10% **ET** mouvement | Verrou + alarme automatique |
| Alerte air | CO₂ > 1500 ppm | Alarme automatique |
| Urgence climat | Temp > 32°C | Alarme automatique |
| Sur-capacité | > 30 élèves comptés | Double-clic du relais (sirène) |

---

## API REST

| Méthode | Endpoint | Description |
|---|---|---|
| GET  | `/api/classrooms` | État de toutes les salles |
| GET  | `/api/classrooms/:id` | État d'une salle |
| GET  | `/api/classrooms/:id/history?sensor=...&limit=...` | Historique des lectures |
| POST | `/api/classrooms/:id/lock` | Verrouiller / déverrouiller (body : `{"lock": true}`) |
| POST | `/api/classrooms/:id/alarm` | Déclencher l'alarme |
| GET  | `/api/alerts` | Historique des alertes |
| GET  | `/api/alerts/active` | Alertes actuellement actives |
| GET  | `/api/thresholds` | Seuils d'alerte |
| PUT  | `/api/thresholds` | Modifier les seuils |
| POST | `/api/demo/run` | Lancer la séquence de démo |
| GET  | `/api/storage` | Diagnostic du stockage local |

---

## Composants Wokwi & pins ESP32

| Capteur / Actionneur | Composant Wokwi | Pin ESP32 |
|---|---|---|
| Température / humidité | DHT22 | GPIO 15 |
| Mouvement | PIR Sensor | GPIO 14 |
| Luminosité | Photoresistor | GPIO 34 (ADC) |
| Bruit (proxy) | Joystick (VRx) | GPIO 35 (ADC) |
| Qualité air (proxy) | Potentiomètre | GPIO 32 (ADC) |
| Présence | IR Receiver | GPIO 27 |
| Serrure | Relay Module | GPIO 26 |
| LED Wi-Fi | LED verte | GPIO 2 |
| LED verrou | LED rouge | GPIO 4 |
| LED mouvement | LED jaune | GPIO 5 |

---

## Dépannage

| Symptôme | Cause | Solution |
|---|---|---|
| `npm start` → "module not found" | `node_modules` absent | `cd dashboard && npm install` |
| Port 3000 occupé | Ancien process Node | `Get-Process node \| Stop-Process -Force` (PowerShell) |
| Wokwi : "license not found" | Première utilisation | `F1 → Wokwi: Request a New License` |
| Dashboard vide | ESP32 pas connecté au broker | Vérifier internet + LED bleue de l'ESP32 |
| Firmware pas chargé après modification | Wokwi cache | F1 → Wokwi: Stop, attendre 3 s, F1 → Wokwi: Start |

---

## Tech stack

- **Firmware** : C++ / Arduino framework / PlatformIO
- **Backend** : Node.js, Express, mqtt.js, Socket.IO
- **Frontend** : HTML / CSS / Vanilla JS, Socket.IO client
- **Protocoles** : MQTT (broker public HiveMQ), WebSocket, REST
- **Simulateur** : Wokwi
- **Persistance** : JSON local (compatible MySQL en production)

---

## Auteurs

Souane Kelmous & Abdellah Elmir — EMSI, Data & IA, 2025/2026

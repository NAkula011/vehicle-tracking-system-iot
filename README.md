# Fleet Guardian

Real-time IoT fleet dashboard for ESP32-based vehicle tracking, control, and monitoring.

Fleet Guardian provides:
- Live vehicle position and route visualization
- My GPS → Vehicle tracing with OSRM route, ETA, and distance
- Engine/lock command controls via MQTT
- Alerts (overspeed, geofence, idle)
- Dynamic settings that affect dashboard behavior immediately
- Responsive UI for desktop and mobile

---

## Tech Stack

### Frontend
- React + TypeScript + Vite
- Tailwind CSS + Radix UI components
- Leaflet maps
- Socket.io client

### Backend
- Node.js + Express
- Socket.io server
- MQTT client
- Supabase integration (auth + data)

### Device
- ESP32 sketch using MQTT publish/subscribe

---

## Project Structure

```text
fleet-guardian-main/
├─ src/                  # Frontend app
├─ backend/              # Express + MQTT + Socket.io backend
├─ esp32/                # ESP32 sketch
├─ public/               # Static assets (logo, etc.)
└─ supabase/             # SQL schema
```

---

## Quick Start

### 1) Prerequisites

- Node.js 18+
- npm
- ESP32 toolchain (Arduino IDE or PlatformIO) if using hardware

### 2) Install Dependencies

From project root:

```bash
npm install
```

Backend dependencies:

```bash
cd backend
npm install
```

### 3) Configure Environment

Create environment files as needed.

#### Frontend (root)

```env
VITE_SOCKET_URL=http://localhost:3000
VITE_BACKEND_API_URL=http://localhost:3000
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
```

#### Backend (`backend/.env`)

```env
PORT=3000
MQTT_URL=mqtt://broker.hivemq.com
MQTT_TOPIC=vehicle/+/location,vehicle/+/status,vehicle/+/ack
CORS_ORIGIN=http://localhost:8080,http://localhost:5173
DEVICE_TIMEOUT_MS=4000
DEVICE_TOPIC_PREFIX=vehicle
DEFAULT_INGEST_TENANT_ID=
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_JWT_AUDIENCE=authenticated
```

### 4) Run Backend

```bash
cd backend
npm run start
```

### 5) Run Frontend

In a new terminal from project root:

```bash
npm run dev
```

Frontend default URL: `http://localhost:8080`

---

## ESP32 Setup

1. Open `esp32/esp32_mqtt_tracker.ino`.
2. Install `PubSubClient` in Arduino IDE.
3. Set Wi-Fi credentials and device ID.
4. Upload to ESP32.

Expected MQTT topics:
- `vehicle/<DEVICE_ID>/location`
- `vehicle/<DEVICE_ID>/status`
- `vehicle/<DEVICE_ID>/command`

Supported command payloads:
- `START_ENGINE`
- `STOP_ENGINE`
- `LOCK`
- `UNLOCK`

---

## Core API Endpoints

### Device Command

`POST /api/device/:deviceId/command`

Example:

```bash
curl -X POST http://localhost:3000/api/device/ESP32_001/command \
  -H 'Content-Type: application/json' \
  -d '{"command":"UNLOCK"}'
```

### Manual Location Ingest (Testing)

`POST /api/location`

```bash
curl -X POST http://localhost:3000/api/location \
  -H 'Content-Type: application/json' \
  -d '{"latitude":28.6139,"longitude":77.209,"speed":42}'
```

---

## Features Overview

- Online-device-only tracking view
- Last-known position fallback on disconnect
- Dynamic focus map modes (`Vehicle`, `My GPS`, `Fit`)
- Auto-zoom + fit controls
- OSRM route rendering (My GPS to vehicle)
- Distance + ETA card
- Notification center with read/unread behavior
- Settings page with live impact across dashboard

---

## Troubleshooting

### Backend exits or does not stay running
- Ensure required env variables are set in `backend/.env`
- Check port conflicts for `3000`

### Frontend shows no live data
- Verify backend is running
- Confirm `VITE_SOCKET_URL` and `VITE_BACKEND_API_URL`
- Check browser console and network tab for socket/API errors

### GPS route / ETA not visible
- Allow browser location permission
- Verify internet access to OSRM (`router.project-osrm.org`)

---

## Testing

Run frontend type checks:

```bash
npx tsc --noEmit
```

Run tests (if configured):

```bash
npm run test
```

---

## Author

**Nakul Mundhada**

---

## License

This project is licensed under the MIT License.
Copyright (c) 2026 Nakul Mundhada.

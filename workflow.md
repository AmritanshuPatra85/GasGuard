# GasGuard — Project Plan & Build Guide

**Owner:** Amritanshu
**Target:** v1.0.0 in ~28 working days (≈1 month)
**Primary user:** Apartment residents (hero) + society admins (secondary)
**Core loop:** leak detected → resident alerted → escalates if unacknowledged → incident logged

This document is the single source of truth for building GasGuard. It covers the repo
layout, database schema, MQTT contract, and every phase/sprint with the exact files each
sprint produces. Keep this file at `docs/PROJECT_PLAN.md` and update the checkboxes as you go.

---

## 1. Tech Stack (reference)

| Layer | Choice |
|---|---|
| Device | ESP32, MQ-6/MQ-2, DHT22, buzzer + LED, PlatformIO/Arduino |
| Messaging | Mosquitto (Docker, TLS, per-device creds) |
| Worker | Node.js + TypeScript, `mqtt.js`, Zod validation |
| Jobs/queues | BullMQ + Redis (escalation timers) |
| Database | Supabase (Postgres, Auth, RLS, Realtime, PostGIS) |
| Frontend | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui |
| Map | MapLibre GL JS + OpenStreetMap tiles |
| Alerts | Web Push (PWA) + Telegram bot |
| Hosting | Next.js → Vercel; worker + broker + Redis → EC2 (Docker Compose + Nginx) |
| CI/CD | GitHub Actions |
| Monorepo | pnpm workspaces |

---

## 2. Repository Structure

```
gasguard/
├── apps/
│   ├── web/                          # Next.js app — resident + admin
│   │   ├── app/
│   │   │   ├── (auth)/login/page.tsx
│   │   │   ├── (auth)/signup/page.tsx
│   │   │   ├── (resident)/dashboard/page.tsx
│   │   │   ├── (resident)/device/[id]/page.tsx
│   │   │   ├── (resident)/settings/contacts/page.tsx
│   │   │   ├── (admin)/society/[id]/page.tsx
│   │   │   ├── (admin)/society/[id]/map/page.tsx
│   │   │   ├── (admin)/society/[id]/devices/page.tsx
│   │   │   ├── (admin)/society/[id]/incidents/page.tsx
│   │   │   ├── (admin)/society/[id]/incidents/[incidentId]/page.tsx
│   │   │   ├── api/devices/claim/route.ts
│   │   │   ├── api/incidents/[id]/ack/route.ts
│   │   │   ├── api/push/subscribe/route.ts
│   │   │   ├── api/webhooks/telegram/route.ts
│   │   │   ├── layout.tsx
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   ├── ui/                   # shadcn primitives
│   │   │   ├── device-card.tsx
│   │   │   ├── status-badge.tsx
│   │   │   ├── live-chart.tsx
│   │   │   ├── society-map.tsx
│   │   │   ├── heatmap-layer.tsx
│   │   │   ├── incident-timeline.tsx
│   │   │   └── qr-scanner.tsx
│   │   ├── lib/
│   │   │   ├── supabase/client.ts
│   │   │   ├── supabase/server.ts
│   │   │   ├── realtime.ts
│   │   │   └── push.ts
│   │   ├── public/manifest.json
│   │   ├── public/sw.js
│   │   ├── next.config.js
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   ├── worker/                       # ingestion + detection + escalation
│   │   ├── src/mqtt/subscriber.ts
│   │   ├── src/mqtt/topics.ts
│   │   ├── src/ingest/validate.ts
│   │   ├── src/ingest/batch-writer.ts
│   │   ├── src/detection/baseline.ts
│   │   ├── src/detection/rate-of-change.ts
│   │   ├── src/detection/state-machine.ts
│   │   ├── src/detection/heartbeat.ts
│   │   ├── src/escalation/queue.ts
│   │   ├── src/escalation/jobs.ts
│   │   ├── src/channels/push.ts
│   │   ├── src/channels/telegram.ts
│   │   ├── src/db/client.ts
│   │   ├── src/db/rollups.ts
│   │   ├── src/index.ts
│   │   ├── test/baseline.test.ts
│   │   ├── test/state-machine.test.ts
│   │   ├── test/fixtures/scenarios.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── simulator/                    # virtual device fleet
│       ├── src/device.ts
│       ├── src/scenarios/normal.ts
│       ├── src/scenarios/slow-leak.ts
│       ├── src/scenarios/sudden-leak.ts
│       ├── src/scenarios/multi-leak.ts
│       ├── src/scenarios/malfunction.ts
│       ├── src/scenarios/offline.ts
│       ├── src/fleet.ts
│       ├── src/index.ts
│       ├── Dockerfile
│       └── package.json
│
├── packages/shared/
│   ├── src/schemas/reading.ts        # Zod schema — single source of truth for payload shape
│   ├── src/schemas/device.ts
│   ├── src/types/incident.ts
│   ├── src/constants.ts
│   └── package.json
│
├── firmware/
│   ├── src/main.cpp
│   ├── src/sensors.cpp / sensors.h
│   ├── src/mqtt_client.cpp / mqtt_client.h
│   ├── src/wifi_setup.cpp / wifi_setup.h
│   ├── platformio.ini
│   └── README.md
│
├── supabase/
│   ├── migrations/0001_core_schema.sql
│   ├── migrations/0002_rls_policies.sql
│   ├── migrations/0003_postgis_and_rollups.sql
│   ├── migrations/0004_pg_cron_jobs.sql
│   └── seed.sql
│
├── infra/
│   ├── docker-compose.yml
│   ├── mosquitto/mosquitto.conf
│   └── nginx/gasguard.conf
│
├── docs/
│   ├── PROJECT_PLAN.md               # this file
│   ├── ARCHITECTURE.md
│   ├── MQTT_CONTRACT.md
│   └── DEMO_SCRIPT.md
│
├── .github/workflows/ci.yml
├── pnpm-workspace.yaml
├── package.json
├── .env.example
└── README.md
```

---

## 3. Database Schema (Supabase / Postgres)

| Table | Key columns | Purpose |
|---|---|---|
| `societies` | id, name, address, lat, lng | Top-level tenant |
| `towers` | id, society_id, name | Building within a society |
| `flats` | id, tower_id, floor, number | A home unit |
| `profiles` | id (→auth.users), full_name, phone, role[`resident`\|`society_admin`], society_id, flat_id | Extends Supabase Auth |
| `devices` | id, flat_id, serial_number, claim_code, status[`unclaimed`\|`active`\|`offline`\|`faulty`], firmware_version, last_seen_at, lat, lng | One ESP32 node |
| `readings` | id, device_id, ts, gas_ppm, temperature, humidity, raw_adc | Raw telemetry, **partitioned by day** |
| `device_baseline` | device_id, mean, stddev, updated_at | Rolling baseline state per device |
| `incidents` | id, device_id, flat_id, society_id, severity[`suspicious`\|`warning`\|`critical`], status[`open`\|`acknowledged`\|`resolved`], opened_at, resolved_at, resolved_by | One leak event |
| `incident_events` | id, incident_id, type[`created`\|`escalated_family`\|`escalated_security`\|`acknowledged`\|`resolved`\|`note`], actor_id, message, created_at | Audit trail |
| `alert_contacts` | id, flat_id, name, phone, relation, priority_order | Escalation targets |
| `readings_1m_rollup` / `readings_1h_rollup` | device_id, bucket_ts, avg_ppm, max_ppm, min_ppm | For charts, heatmap, replay |
| `push_subscriptions` | id, user_id, endpoint, keys (jsonb) | Web Push targets |
| `telegram_links` | user_id, chat_id | Telegram alert targets |

**RLS rules (enforced in Phase 1, tested continuously):**
- A resident can `SELECT` only rows where `flat_id = their flat`.
- A society admin can `SELECT` from a **view** (`society_device_status`) exposing status/severity only — never raw `readings`.
- All writes to `readings`/`incidents` happen through the worker's service-role key, never from the client.

---

## 4. MQTT Contract (locked in Phase 1, never changes after)

```
Topic (telemetry): gasguard/{society_id}/{device_id}/telemetry   — QoS 1
Topic (status/LWT): gasguard/{society_id}/{device_id}/status     — QoS 1, retained

Telemetry payload:
{
  "ts": "2026-09-22T10:15:30Z",
  "gas_ppm": 412,
  "temp_c": 29.4,
  "humidity_pct": 61,
  "rssi": -58,
  "fw_version": "1.0.0"
}

Status payload: "online" | "offline"  (offline is the LWT, set by the broker on disconnect)
```

The simulator publishes this exact shape, so swapping in real firmware in Phase 7 requires no worker changes.

---

## 5. Phases & Sprints

9 phases, 20 sprints, ~28 working days. Each sprint ends with a commit; each phase ends with
a PR into `main`, a green CI run, and a tag. Work one sprint at a time.

### Phase 0 — Foundation (1 day, 1 sprint)

**Sprint 0.1 — Monorepo & CI (1 day)**
- Goal: a clone-and-run skeleton with working CI.
- Files: `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, `.eslintrc.cjs`, `.prettierrc`, `.env.example`, `infra/docker-compose.yml` (Mosquitto + Redis only for now), `.github/workflows/ci.yml`, `README.md` (stub).
- DB: create the Supabase project (no schema yet).
- Done when: `pnpm install` succeeds, `docker compose up` starts Mosquitto + Redis, CI runs lint on an empty repo and passes.

---

### Phase 1 — Data Layer & Contract (2 days, 2 sprints)

**Sprint 1.1 — Schema & RLS (1 day)**
- Files: `supabase/migrations/0001_core_schema.sql` (all tables from §3 except rollups/PostGIS), `supabase/migrations/0002_rls_policies.sql`, `supabase/seed.sql` (2 societies, a few towers/flats).
- DB work: table creation, foreign keys, enums, indexes on `device_id, ts`, RLS policies + the `society_device_status` view.
- Done when: migrations apply cleanly on a fresh Supabase project; a manual RLS test (two test users, two societies) proves isolation.

**Sprint 1.2 — Shared contract package (1 day)**
- Files: `packages/shared/src/schemas/reading.ts` (Zod schema matching §4), `packages/shared/src/schemas/device.ts`, `packages/shared/src/types/incident.ts`, `packages/shared/src/constants.ts` (topic templates, severity thresholds), `docs/MQTT_CONTRACT.md`.
- Backend work: none yet — this package is imported by worker, simulator, and firmware docs.
- Done when: `packages/shared` builds and is importable from `apps/worker` and `apps/simulator`.

---

### Phase 2 — Simulator & Ingestion (4 days, 3 sprints)

**Sprint 2.1 — Simulator core + scenarios (1.5 days)**
- Files: `apps/simulator/src/device.ts` (one virtual device publish loop), `apps/simulator/src/fleet.ts` (spawns N devices), `apps/simulator/src/scenarios/{normal,slow-leak,sudden-leak,multi-leak,malfunction,offline}.ts`, `apps/simulator/src/index.ts`.
- Backend work: MQTT publish via `mqtt.js`, scenario-driven `gas_ppm` curves.
- Done when: running the simulator locally publishes valid messages (checked with `mosquitto_sub`) for all 6 scenarios.

**Sprint 2.2 — Ingestion worker (1.5 days)**
- Files: `apps/worker/src/mqtt/subscriber.ts`, `apps/worker/src/mqtt/topics.ts`, `apps/worker/src/ingest/validate.ts` (Zod parse, drop malformed), `apps/worker/src/ingest/batch-writer.ts` (buffered inserts), `apps/worker/src/db/client.ts`, `apps/worker/src/index.ts`.
- Backend work: subscribe to `gasguard/+/+/telemetry`, validate, batch-insert into `readings`, update `devices.last_seen_at`.
- Done when: 50 simulated devices running for 2 minutes produce the expected row count in `readings` with zero validation errors.

**Sprint 2.3 — Deploy the pipeline (1 day)**
- Files: `infra/mosquitto/mosquitto.conf` (TLS, per-device auth), `apps/worker/Dockerfile`, `apps/simulator/Dockerfile`, updated `infra/docker-compose.yml` (adds worker + simulator services), `infra/nginx/gasguard.conf`.
- Infra work: provision EC2, `docker compose up -d` on the box, confirm the worker writes to Supabase from the cloud.
- Done when: 500 simulated devices run for 10 minutes against the **deployed** broker+worker with no dropped messages.

---

### Phase 3 — Detection & Incident Engine (3 days, 2 sprints)

**Sprint 3.1 — Baseline & anomaly detection (1.5 days)**
- Files: `apps/worker/src/detection/baseline.ts` (EWMA + z-score, updates `device_baseline`), `apps/worker/src/detection/rate-of-change.ts`.
- Backend/DB work: read/write `device_baseline`; flag readings as suspicious based on deviation and slope.
- Done when: feeding the slow-leak fixture produces a rising anomaly score; feeding hours of normal-scenario data produces none.

**Sprint 3.2 — State machine, heartbeat, tests (1.5 days)**
- Files: `apps/worker/src/detection/state-machine.ts` (normal→suspicious→warning→critical→resolved, with hysteresis), `apps/worker/src/detection/heartbeat.ts` (marks devices offline after N missed intervals), `apps/worker/test/baseline.test.ts`, `apps/worker/test/state-machine.test.ts`, `apps/worker/test/fixtures/scenarios.ts`.
- DB work: writes to `incidents` and `incident_events` on state transitions.
- Done when: Vitest suite passes; the sudden-leak scenario walks the full chain to `critical` and back to `resolved` once levels drop.

---

### Phase 4 — Web App Core (4 days, 3 sprints)

**Sprint 4.1 — Auth, roles, device claim (1.5 days)**
- Files: `apps/web/app/(auth)/login/page.tsx`, `.../signup/page.tsx`, `apps/web/lib/supabase/client.ts`, `.../server.ts`, `apps/web/app/api/devices/claim/route.ts`, `apps/web/components/qr-scanner.tsx`.
- DB/backend work: Supabase Auth wiring, `profiles` row creation on signup, claim endpoint validates `claim_code` and links `device→flat`.
- Done when: a new user can sign up, scan a QR code, and see their device move from `unclaimed` to `active`.

**Sprint 4.2 — Resident dashboard (1 day)**
- Files: `apps/web/app/(resident)/dashboard/page.tsx`, `.../device/[id]/page.tsx`, `apps/web/components/device-card.tsx`, `.../status-badge.tsx`, `.../live-chart.tsx`, `apps/web/lib/realtime.ts`.
- Frontend work: live status card, Recharts line chart of recent readings, Supabase Realtime subscription.
- Done when: a resident sees their flat's live gas/temp/humidity updating within ~1 second of a simulated reading.

**Sprint 4.3 — Society admin dashboard (1.5 days)**
- Files: `apps/web/app/(admin)/society/[id]/page.tsx`, `.../devices/page.tsx`, `apps/web/app/(resident)/settings/contacts/page.tsx` (alert contacts CRUD, ties to `alert_contacts`).
- DB/backend work: queries against the `society_device_status` view only (no raw readings ever reach the admin client).
- Done when: an admin sees per-flat status (not raw ppm) and device health across the society; a resident manages their escalation contacts.

---

### Phase 5 — Alerts & Escalation (4 days, 3 sprints)

**Sprint 5.1 — Escalation engine (1.5 days)**
- Files: `apps/worker/src/escalation/queue.ts` (BullMQ setup), `apps/worker/src/escalation/jobs.ts` (resident→family→security timers, cancels on ack).
- Backend work: on `warning`/`critical`, enqueue a delayed job chain keyed by `incident_id`; an ack event cancels remaining jobs.
- Done when: a critical incident with no ack fires all three escalation steps in order with correct delays; an ack at any step halts the rest.

**Sprint 5.2 — Alert channels (1.5 days)**
- Files: `apps/worker/src/channels/push.ts`, `apps/worker/src/channels/telegram.ts`, `apps/web/app/api/push/subscribe/route.ts`, `apps/web/app/api/webhooks/telegram/route.ts`, `apps/web/public/sw.js`, `apps/web/public/manifest.json`, `apps/web/lib/push.ts`.
- Backend/frontend work: PWA installs and registers for Web Push; a Telegram bot links to a user via `/start`; worker sends through both.
- Done when: triggering an incident delivers a push notification and a Telegram message to a real test account.

**Sprint 5.3 — Incident timeline & acknowledge UI (1 day)**
- Files: `apps/web/app/api/incidents/[id]/ack/route.ts`, `apps/web/components/incident-timeline.tsx`, `apps/web/app/(admin)/society/[id]/incidents/page.tsx`, `.../incidents/[incidentId]/page.tsx`.
- Frontend work: one-tap acknowledge button, incident detail page rendering `incident_events` as a timeline, society-wide incident list.
- Done when: acknowledging from the resident dashboard is reflected instantly in the admin incident view.

---

### Phase 6 — Map & Heatmap (3 days, 2 sprints)

**Sprint 6.1 — Society map with live markers (1.5 days)**
- Files: `apps/web/app/(admin)/society/[id]/map/page.tsx`, `apps/web/components/society-map.tsx`.
- Frontend work: MapLibre GL map, tower/floor or site-plan layout, markers colored by `society_device_status`, live updates via Realtime.
- Done when: a simulated leak visibly changes a marker's color on the map within seconds.

**Sprint 6.2 — Heatmap layer + filters (1.5 days)**
- Files: `apps/web/components/heatmap-layer.tsx`, `supabase/migrations/0003_postgis_and_rollups.sql` (PostGIS extension, `readings_1m_rollup`/`readings_1h_rollup`, GeoJSON view), `supabase/migrations/0004_pg_cron_jobs.sql` (rollup + retention jobs).
- DB/backend work: `pg_cron` populates rollups; a view returns weighted GeoJSON (severity-weighted, not device-count-weighted).
- Done when: the heatmap visibly hotspots over a cluster of simulated leaks and stays flat over healthy devices; last-24h / max-ppm filters work.

*(Time-slider replay is a stretch goal here — build only if Phase 7 and 8 are on track.)*

---

### Phase 7 — Hardware (4 days, 2 sprints)

**Sprint 7.1 — Firmware: sensors + MQTT (2 days)**
- Files: `firmware/src/main.cpp`, `firmware/src/sensors.cpp/.h` (MQ sensor + DHT22 reads, warm-up handling), `firmware/src/mqtt_client.cpp/.h` (publishes the exact §4 payload), `firmware/platformio.ini`.
- Hardware work: wire MQ-6/MQ-2 to ADC1, DHT22, buzzer+LED; publish real telemetry to the deployed broker.
- Done when: the real device's messages land in `readings` and are indistinguishable in shape from simulator messages.

**Sprint 7.2 — Wi-Fi provisioning + field test (2 days)**
- Files: `firmware/src/wifi_setup.cpp/.h` (WiFiManager captive portal), `firmware/README.md` (flashing + provisioning instructions).
- Work: claim the real device through the app's QR flow, run it in a real flat/room, trigger a real (controlled, ventilated) gas source or a lighter's unburned gas near the sensor, and time sensor-to-alert.
- Done when: you have a measured, written-down sensor-to-phone-alert latency from a real trigger.

---

### Phase 8 — Proof & Polish (3 days, 2 sprints)

**Sprint 8.1 — Load test & metrics (1 day)**
- Files: a `k6` script or a simulator "load mode" flag, results saved to `docs/LOAD_TEST_RESULTS.md`.
- Work: run 500+ simulated devices against the deployed pipeline; record ingest throughput and p95 detection-to-alert latency.
- Done when: you have real numbers to put in the README and resume.

**Sprint 8.2 — README, demo, cleanup, tag (2 days)**
- Files: final `README.md` (architecture diagram, setup, the safety disclaimer about uncalibrated MQ sensors), `docs/ARCHITECTURE.md`, `docs/DEMO_SCRIPT.md`, a 2-minute screen-recorded demo video (linked, not committed), always-on public demo deployment.
- Done when: a stranger can open the live URL, watch the simulator create an incident, watch it escalate, and read a README that explains how it all fits together. Tag `v1.0.0`.

---

## 6. Git Workflow (PowerShell-compatible)

One branch per **phase**, one commit per **sprint** on that branch, PR into `main` at the end of the phase, tag after merge.

```powershell
git checkout -b phase-1-data-layer

# after Sprint 1.1
git add .
git commit -m "feat(db): core schema, RLS policies, seed data"

# after Sprint 1.2
git add .
git commit -m "feat(shared): mqtt contract, zod schemas, constants"

git push -u origin phase-1-data-layer
# open PR on GitHub, merge into main, then:
git checkout main
git pull
git tag -a phase-1 -m "Phase 1: data layer and contract"
git push origin phase-1
```

Only merge a phase when CI is green and its phase-level "done when" checks all pass.

---

## 7. If You Fall Behind — Cut in This Order

1. Time-slider replay (never fully scheduled — only build if ahead)
2. Heatmap filters
3. Telegram channel polish (keep Web Push as the primary channel)
4. Heatmap layer itself

**Never cut:** Phase 2 (ingestion), Phase 3 (detection), Phase 5 (escalation), the EC2 deployment, or the one real hardware node in Phase 7. These are what separate GasGuard from a CRUD dashboard.
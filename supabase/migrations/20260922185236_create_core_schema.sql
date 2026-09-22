-- =========================================================
-- GasGuard core schema
-- =========================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- Tenant chain: societies -> towers -> flats -> devices
-- ---------------------------------------------------------

create table societies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city        text,
  created_at  timestamptz not null default now()
);

create table towers (
  id          uuid primary key default gen_random_uuid(),
  society_id  uuid not null references societies(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table flats (
  id          uuid primary key default gen_random_uuid(),
  tower_id    uuid not null references towers(id) on delete cascade,
  number      text not null,
  floor       integer,
  created_at  timestamptz not null default now()
);

create table devices (
  id                uuid primary key default gen_random_uuid(),
  flat_id           uuid not null references flats(id) on delete cascade,
  device_key        text not null unique,
  status            text not null default 'provisioned'
                     check (status in ('provisioned','active','offline','disabled')),
  firmware_version  text,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Telemetry: append-only history + latest-snapshot
-- ---------------------------------------------------------

create table readings (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references devices(id) on delete cascade,
  recorded_at   timestamptz not null,
  gas_raw       numeric,
  gas_value     numeric,
  temperature   numeric,
  humidity      numeric,
  sequence      bigint not null,
  created_at    timestamptz not null default now(),
  unique (device_id, sequence)   -- idempotency: reject duplicate/retried messages
);

create index on readings (device_id, recorded_at desc);

create table device_state (
  device_id     uuid primary key references devices(id) on delete cascade,
  last_seen     timestamptz,
  current_gas   numeric,
  health        text not null default 'unknown'
                 check (health in ('unknown','ok','warning','critical','offline')),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Incidents: current state + immutable timeline
-- ---------------------------------------------------------

create table incidents (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references devices(id) on delete cascade,
  severity      text not null check (severity in ('suspicious','warning','critical')),
  state         text not null default 'open'
                 check (state in ('open','acknowledged','escalated','recovering','resolved')),
  started_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

create index on incidents (device_id, state);

create table incident_events (
  id            uuid primary key default gen_random_uuid(),
  incident_id   uuid not null references incidents(id) on delete cascade,
  event_type    text not null,
  actor         text,
  payload       jsonb,
  created_at    timestamptz not null default now()
);

create index on incident_events (incident_id, created_at);

-- ---------------------------------------------------------
-- Escalation: config + attempt log
-- ---------------------------------------------------------

create table alert_contacts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('resident','family','security')),
  channel       text not null check (channel in ('sms','push','call','email')),
  destination   text not null,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now()
);

create table alerts (
  id            uuid primary key default gen_random_uuid(),
  incident_id   uuid not null references incidents(id) on delete cascade,
  contact_id    uuid not null references alert_contacts(id) on delete cascade,
  channel       text not null,
  status        text not null default 'pending'
                 check (status in ('pending','sent','delivered','failed')),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Multi-tenant membership: many-to-many, resident or admin
-- ---------------------------------------------------------

create table memberships (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  society_id    uuid references societies(id) on delete cascade,
  flat_id       uuid references flats(id) on delete cascade,
  role          text not null check (role in ('resident','admin')),
  created_at    timestamptz not null default now(),

  constraint membership_scope_check check (
    (role = 'admin'    and society_id is not null and flat_id is null) or
    (role = 'resident' and flat_id is not null and society_id is null)
  )
);

create index on memberships (user_id);
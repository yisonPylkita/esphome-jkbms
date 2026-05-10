#!/usr/bin/env node
//
// Bulk-rename HA entity IDs via the WebSocket API. Used once after the
// Zigbee2MQTT friendly_name rename — Z2M's MQTT discovery doesn't change
// existing entity_ids (they're pinned by unique_id), so we patch HA's
// entity registry directly.
//
// Usage:  node scripts/rename-ha-entities.mjs
// Reads ha_host / ha_token from secrets.yaml.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECRETS = path.join(HERE, '..', 'secrets.yaml');

function readSecret(key) {
  const t = fs.readFileSync(SECRETS, 'utf8');
  const m = t.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'));
  return m ? m[1] : null;
}
const HA_HOST = process.env.HA_HOST || readSecret('ha_host');
const HA_TOKEN = process.env.HA_TOKEN || readSecret('ha_token');
if (!HA_HOST || !HA_TOKEN) {
  console.error('ha_host / ha_token must be in secrets.yaml or env');
  process.exit(1);
}

// Rewrite rules: any entity_id whose suffix-after-domain starts with the
// LHS gets that prefix replaced with the RHS.
//   `binary_sensor.movementsensor_occupancy` -> match `movementsensor` -> `battery_room_motion_main`
//   `sensor.0xa4c13889af0fd9e7_battery`      -> match `0xa4c13889af0fd9e7` -> `battery_room_door`
const PREFIX_MAP = {
  movementsensor: 'battery_room_motion_main',
  '0xa4c1389267954032': 'battery_room_motion_aux',
  '0xa4c13889af0fd9e7': 'battery_room_door',
  '0xa4c1388fb2a89f51': 'battery_room_siren',
};

function rewrite(entityId) {
  const dot = entityId.indexOf('.');
  if (dot < 0) return null;
  const domain = entityId.slice(0, dot);
  const slug = entityId.slice(dot + 1);
  for (const [from, to] of Object.entries(PREFIX_MAP)) {
    if (slug === from) return `${domain}.${to}`;
    if (slug.startsWith(from + '_')) {
      return `${domain}.${to}_${slug.slice(from.length + 1)}`;
    }
  }
  return null;
}

let nextId = 1;
const pending = new Map();
const sendNext = (ws, type, body) => {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, type, ...body }));
  });
};

const ws = new WebSocket(`ws://${HA_HOST}:8123/api/websocket`);
ws.addEventListener('error', (e) => {
  console.error('ws error', e.message || e);
  process.exit(1);
});
ws.addEventListener('message', async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === 'auth_required') {
    ws.send(JSON.stringify({ type: 'auth', access_token: HA_TOKEN }));
    return;
  }
  if (m.type === 'auth_ok') {
    main(ws).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    return;
  }
  if (m.type === 'auth_invalid') {
    console.error('auth_invalid');
    process.exit(1);
  }
  if (m.type === 'result' && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.success) resolve(m.result);
    else reject(new Error(JSON.stringify(m.error)));
  }
});

async function main(ws) {
  const entities = await sendNext(ws, 'config/entity_registry/list', {});
  let renamed = 0,
    skipped = 0,
    conflict = 0;
  for (const e of entities) {
    const target = rewrite(e.entity_id);
    if (!target || target === e.entity_id) continue;
    if (entities.some((x) => x.entity_id === target)) {
      console.warn(`! ${e.entity_id} -> ${target}: target already exists, skipping`);
      conflict++;
      continue;
    }
    try {
      await sendNext(ws, 'config/entity_registry/update', {
        entity_id: e.entity_id,
        new_entity_id: target,
      });
      console.log(`✓ ${e.entity_id} -> ${target}`);
      renamed++;
    } catch (err) {
      console.warn(`! ${e.entity_id} -> ${target}: ${err.message}`);
      skipped++;
    }
  }
  console.log(`\n${renamed} renamed · ${skipped} failed · ${conflict} conflicts`);
  ws.close();
}

#!/usr/bin/env node

// NISPS → OSC Bridge
// WebSocket server that receives parameter updates from the browser
// and forwards them as OSC messages to any OSC-capable software.
//
// Usage:
//   node bridge.mjs                              # defaults: ws:8765, osc:127.0.0.1:57120
//   node bridge.mjs --osc-host 192.168.1.5       # send to another machine
//   node bridge.mjs --osc-port 9000              # SuperCollider on custom port
//   node bridge.mjs --ws-port 8765               # WebSocket listen port
//   node bridge.mjs --osc-prefix /nisps          # OSC address prefix (default: /nisps)
//   node bridge.mjs --bundle                     # send OSC bundles instead of individual messages
//
// OSC address format:
//   /nisps/<param_name> <float>
//   e.g. /nisps/Env_A_Att 0.35
//        /nisps/SVF_Cutoff 0.72

import { createSocket } from 'node:dgram';
import { WebSocketServer } from 'ws';

// ---- CLI args ----
const args = process.argv.slice(2);
function flag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
}
const hasFlag = (name) => args.includes(`--${name}`);

const WS_PORT = parseInt(flag('ws-port', '8765'), 10);
const OSC_HOST = flag('osc-host', '127.0.0.1');
const OSC_PORT = parseInt(flag('osc-port', '57120'), 10);
const OSC_PREFIX = flag('osc-prefix', '/nisps');
const USE_BUNDLES = hasFlag('bundle');

// ---- OSC encoding (minimal, no dependencies) ----

function oscString(str) {
  const len = str.length + 1; // null terminator
  const padded = len + (4 - (len % 4)) % 4;
  const buf = Buffer.alloc(padded);
  buf.write(str, 'ascii');
  return buf;
}

function oscFloat(val) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(val, 0);
  return buf;
}

function oscMessage(address, value) {
  return Buffer.concat([
    oscString(address),
    oscString(',f'),
    oscFloat(value),
  ]);
}

function oscBundle(messages) {
  const header = oscString('#bundle');
  // NTP timestamp: immediately (1 in upper 32 bits)
  const timetag = Buffer.alloc(8);
  timetag.writeUInt32BE(1, 0);

  const parts = [header, timetag];
  for (const msg of messages) {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(msg.length, 0);
    parts.push(size, msg);
  }
  return Buffer.concat(parts);
}

// ---- UDP socket ----
const udp = createSocket('udp4');

function sendOSC(address, value) {
  const msg = oscMessage(address, value);
  udp.send(msg, OSC_PORT, OSC_HOST);
}

function sendOSCBundle(params) {
  const messages = params.map(([name, value]) =>
    oscMessage(`${OSC_PREFIX}/${name}`, value)
  );
  const bundle = oscBundle(messages);
  udp.send(bundle, OSC_PORT, OSC_HOST);
}

// ---- WebSocket server ----
const wss = new WebSocketServer({ port: WS_PORT });

let clientCount = 0;

wss.on('connection', (ws) => {
  clientCount++;
  console.log(`[ws] Client connected (${clientCount} total)`);

  // Tell the browser what we're targeting
  ws.send(JSON.stringify({
    type: 'info',
    message: `OSC → ${OSC_HOST}:${OSC_PORT} (prefix: ${OSC_PREFIX})`,
  }));

  ws.on('message', (data) => {
    try {
      // Expects: [[paramName, value], ...]
      const batch = JSON.parse(data);
      if (!Array.isArray(batch)) return;

      if (USE_BUNDLES) {
        sendOSCBundle(batch);
      } else {
        for (const [name, value] of batch) {
          sendOSC(`${OSC_PREFIX}/${name}`, value);
        }
      }
    } catch (e) {
      console.error('[ws] Bad message:', e.message);
    }
  });

  ws.on('close', () => {
    clientCount--;
    console.log(`[ws] Client disconnected (${clientCount} remaining)`);
  });
});

console.log(`
NISPS → OSC Bridge
──────────────────
  WebSocket:  ws://localhost:${WS_PORT}
  OSC target: ${OSC_HOST}:${OSC_PORT}
  Prefix:     ${OSC_PREFIX}
  Mode:       ${USE_BUNDLES ? 'bundles' : 'individual messages'}

  OSC addresses: ${OSC_PREFIX}/<param_name> <float>
  e.g. ${OSC_PREFIX}/Env_A_Att 0.35
       ${OSC_PREFIX}/SVF_Cut 0.72

  Waiting for browser connection...
`);

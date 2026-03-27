#!/usr/bin/env node

// NISPS <-> OSC Bridge (bidirectional)
// WebSocket server that bridges the browser webapp and OSC-capable software
// (VCV Rack MEMLNaut module, SuperCollider, etc.).
//
// Usage:
//   node bridge.mjs                              # defaults
//   node bridge.mjs --osc-host 192.168.1.5       # send to another machine
//   node bridge.mjs --osc-port 9000              # target port
//   node bridge.mjs --ws-port 8765               # WebSocket listen port
//   node bridge.mjs --listen-port 9001           # UDP listen port for incoming OSC
//   node bridge.mjs --osc-prefix /nisps          # OSC address prefix
//   node bridge.mjs --bundle                     # send OSC bundles
//
// Webapp -> Bridge -> OSC target (param updates, state, weights)
// OSC target -> Bridge -> Webapp (output values, input values)

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
const OSC_PORT = parseInt(flag('osc-port', '9000'), 10);
const OSC_PREFIX = flag('osc-prefix', '/nisps');
const LISTEN_PORT = parseInt(flag('listen-port', '9001'), 10);
const USE_BUNDLES = hasFlag('bundle');

// ---- OSC encoding (minimal, no dependencies) ----

function oscPadded(len) {
  return len + (4 - (len % 4)) % 4;
}

function oscString(str) {
  const len = str.length + 1; // null terminator
  const padded = oscPadded(len);
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

function oscMessageString(address, value) {
  return Buffer.concat([
    oscString(address),
    oscString(',s'),
    oscString(value),
  ]);
}

function oscBundle(messages) {
  const header = oscString('#bundle');
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

// ---- OSC decoding ----

function readOscString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const str = buf.toString('ascii', offset, end);
  const nextOffset = offset + oscPadded(end - offset + 1);
  return [str, nextOffset];
}

function readOscFloat(buf, offset) {
  if (offset + 4 > buf.length) return [0, offset + 4];
  return [buf.readFloatBE(offset), offset + 4];
}

function parseOscMessage(buf) {
  if (buf.length < 4) return null;
  let offset = 0;

  const [address, off1] = readOscString(buf, offset);
  if (!address.startsWith('/')) return null;
  offset = off1;

  const [tags, off2] = readOscString(buf, offset);
  if (!tags.startsWith(',')) return null;
  offset = off2;

  const types = tags.slice(1);
  const args = [];

  for (const t of types) {
    if (t === 'f') {
      const [val, off] = readOscFloat(buf, offset);
      args.push(val);
      offset = off;
    } else if (t === 's') {
      const [val, off] = readOscString(buf, offset);
      args.push(val);
      offset = off;
    }
  }

  return { address, types, args };
}

// ---- UDP sockets ----

// Outgoing: sends OSC to target
const udpSend = createSocket('udp4');

function sendOSC(address, value) {
  const msg = oscMessage(address, value);
  udpSend.send(msg, OSC_PORT, OSC_HOST);
}

function sendOSCString(address, value) {
  const msg = oscMessageString(address, value);
  udpSend.send(msg, OSC_PORT, OSC_HOST);
}

function sendOSCBundle(params) {
  const messages = params.map(([name, value]) =>
    oscMessage(`${OSC_PREFIX}/${name}`, value)
  );
  const bundle = oscBundle(messages);
  udpSend.send(bundle, OSC_PORT, OSC_HOST);
}

// Incoming: listens for OSC from target
const udpRecv = createSocket('udp4');
udpRecv.bind(LISTEN_PORT, '0.0.0.0');

udpRecv.on('message', (buf, _rinfo) => {
  const msg = parseOscMessage(buf);
  if (!msg) return;

  const wsMsg = { type: 'osc', address: msg.address };

  if (msg.address === `${OSC_PREFIX}/output` || msg.address === '/nisps/output') {
    wsMsg.type = 'outputs';
    wsMsg.values = msg.args.filter(a => typeof a === 'number');
  } else if (msg.address === `${OSC_PREFIX}/input` || msg.address === '/nisps/input') {
    wsMsg.type = 'inputs';
    wsMsg.values = msg.args.filter(a => typeof a === 'number');
  } else {
    wsMsg.args = msg.args;
  }

  broadcastToWs(JSON.stringify(wsMsg));
});

udpRecv.on('error', (err) => {
  console.error('[udp] Listen error:', err.message);
});

// ---- WebSocket server ----
const wss = new WebSocketServer({ port: WS_PORT });
const wsClients = new Set();

function broadcastToWs(data) {
  for (const ws of wsClients) {
    try {
      if (ws.readyState === 1) { // OPEN
        ws.send(data);
      }
    } catch {
      // ignore
    }
  }
}

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[ws] Client connected (${wsClients.size} total)`);

  ws.send(JSON.stringify({
    type: 'info',
    message: `OSC <-> ${OSC_HOST}:${OSC_PORT} (prefix: ${OSC_PREFIX}, listen: ${LISTEN_PORT})`,
  }));

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);

      // Structured message format: { type, payload }
      if (data && typeof data === 'object' && data.type) {
        switch (data.type) {
          case 'state':
            sendOSCString(`${OSC_PREFIX}/state`, JSON.stringify(data.payload));
            return;
          case 'weights':
            sendOSCString(`${OSC_PREFIX}/weights`, JSON.stringify(data.payload));
            return;
          case 'params':
            if (Array.isArray(data.payload)) {
              if (USE_BUNDLES) {
                sendOSCBundle(data.payload);
              } else {
                for (const [name, value] of data.payload) {
                  sendOSC(`${OSC_PREFIX}/${name}`, value);
                }
              }
            }
            return;
        }
      }

      // Legacy format: [[paramName, value], ...]
      if (Array.isArray(data)) {
        if (USE_BUNDLES) {
          sendOSCBundle(data);
        } else {
          for (const [name, value] of data) {
            sendOSC(`${OSC_PREFIX}/${name}`, value);
          }
        }
      }
    } catch (e) {
      console.error('[ws] Bad message:', e.message);
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[ws] Client disconnected (${wsClients.size} remaining)`);
  });
});

console.log(`
NISPS <-> OSC Bridge (bidirectional)
────────────────────────────────────
  WebSocket:    ws://localhost:${WS_PORT}
  OSC target:   ${OSC_HOST}:${OSC_PORT}
  OSC listen:   0.0.0.0:${LISTEN_PORT}
  Prefix:       ${OSC_PREFIX}
  Mode:         ${USE_BUNDLES ? 'bundles' : 'individual messages'}

  Webapp -> VCV:
    params:  [[name, value], ...]  or  { type: "params", payload: [...] }
    state:   { type: "state", payload: <JSON> }
    weights: { type: "weights", payload: <JSON> }

  VCV -> Webapp:
    /nisps/output <f...f>  ->  { type: "outputs", values: [...] }
    /nisps/input  <f...f>  ->  { type: "inputs",  values: [...] }

  Waiting for connections...
`);

#!/usr/bin/env -S deno run --allow-net --unstable-net

// NISPS → OSC Bridge
// Zero-dependency bridge: WebSocket server receives parameter updates from the
// browser and forwards them as OSC messages to any OSC-capable software.
//
// Run with Deno:
//   deno run --allow-net bridge.ts
//
// Or use the compiled binary:
//   ./nisps-osc-bridge
//
// Options:
//   --osc-host 192.168.1.5       Target IP (default: 127.0.0.1)
//   --osc-port 9000              Target port (default: 57120 / SuperCollider)
//   --osc-prefix /my             Address prefix (default: /nisps)
//   --ws-port 8000               WebSocket listen port (default: 8765)
//   --bundle                     Send OSC bundles instead of individual messages
//
// OSC address format:
//   /nisps/<param_name> <float>
//   e.g. /nisps/Env_A_Att 0.35
//        /nisps/SVF_Flt_Cut 0.72

import { parseArgs } from "jsr:@std/cli@1/parse-args";

// ---- CLI args ----
const args = parseArgs(Deno.args, {
  string: ["osc-host", "osc-port", "osc-prefix", "ws-port"],
  boolean: ["bundle", "help"],
  default: {
    "osc-host": "127.0.0.1",
    "osc-port": "57120",
    "osc-prefix": "/nisps",
    "ws-port": "8765",
    "bundle": false,
    "help": false,
  },
});

if (args.help) {
  console.log(`
NISPS → OSC Bridge

Usage: nisps-osc-bridge [options]

Options:
  --osc-host <ip>     Target IP address (default: 127.0.0.1)
  --osc-port <port>   Target UDP port (default: 57120)
  --osc-prefix <pfx>  OSC address prefix (default: /nisps)
  --ws-port <port>    WebSocket listen port (default: 8765)
  --bundle            Send OSC bundles instead of individual messages
  --help              Show this help
`);
  Deno.exit(0);
}

const WS_PORT = parseInt(args["ws-port"]);
const OSC_HOST = args["osc-host"];
const OSC_PORT = parseInt(args["osc-port"]);
const OSC_PREFIX = args["osc-prefix"];
const USE_BUNDLES = args.bundle;

// ---- OSC encoding (zero dependencies) ----

function oscString(str: string): Uint8Array {
  const encoder = new TextEncoder();
  const strBytes = encoder.encode(str);
  const len = strBytes.length + 1; // null terminator
  const padded = len + (4 - (len % 4)) % 4;
  const buf = new Uint8Array(padded);
  buf.set(strBytes);
  return buf;
}

function oscFloat(val: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, val, false); // big-endian
  return new Uint8Array(buf);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function oscMessage(address: string, value: number): Uint8Array {
  return concat(oscString(address), oscString(",f"), oscFloat(value));
}

function u32be(val: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, val, false);
  return new Uint8Array(buf);
}

function oscBundle(messages: Uint8Array[]): Uint8Array {
  const header = oscString("#bundle");
  // NTP timestamp: immediately (1 in upper 32 bits)
  const timetag = new Uint8Array(8);
  new DataView(timetag.buffer).setUint32(0, 1, false);

  const parts: Uint8Array[] = [header, timetag];
  for (const msg of messages) {
    parts.push(u32be(msg.length), msg);
  }
  return concat(...parts);
}

// ---- UDP socket ----
const udp = Deno.listenDatagram({ port: 0, transport: "udp", hostname: "0.0.0.0" });
const oscAddr: Deno.NetAddr = { transport: "udp", hostname: OSC_HOST, port: OSC_PORT };

function sendOSC(address: string, value: number): void {
  const msg = oscMessage(address, value);
  udp.send(msg, oscAddr);
}

function sendOSCBundle(params: [string, number][]): void {
  const messages = params.map(([name, value]) =>
    oscMessage(`${OSC_PREFIX}/${name}`, value)
  );
  const bundle = oscBundle(messages);
  udp.send(bundle, oscAddr);
}

// ---- WebSocket server (Deno built-in) ----
let clientCount = 0;

function handleWs(ws: WebSocket): void {
  clientCount++;
  console.log(`[ws] Client connected (${clientCount} total)`);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "info",
      message: `OSC → ${OSC_HOST}:${OSC_PORT} (prefix: ${OSC_PREFIX})`,
    }));
  };

  ws.onmessage = (e) => {
    try {
      const batch = JSON.parse(e.data as string);
      if (!Array.isArray(batch)) return;

      if (USE_BUNDLES) {
        sendOSCBundle(batch);
      } else {
        for (const [name, value] of batch) {
          sendOSC(`${OSC_PREFIX}/${name}`, value);
        }
      }
    } catch (err) {
      console.error("[ws] Bad message:", (err as Error).message);
    }
  };

  ws.onclose = () => {
    clientCount--;
    console.log(`[ws] Client disconnected (${clientCount} remaining)`);
  };
}

Deno.serve({ port: WS_PORT }, (req) => {
  // Only accept WebSocket upgrades
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("NISPS OSC Bridge — connect via WebSocket", { status: 200 });
  }
  const { socket, response } = Deno.upgradeWebSocket(req);
  handleWs(socket);
  return response;
});

console.log(`
NISPS → OSC Bridge
──────────────────
  WebSocket:  ws://localhost:${WS_PORT}
  OSC target: ${OSC_HOST}:${OSC_PORT}
  Prefix:     ${OSC_PREFIX}
  Mode:       ${USE_BUNDLES ? "bundles" : "individual messages"}

  OSC addresses: ${OSC_PREFIX}/<param_name> <float>
  e.g. ${OSC_PREFIX}/Env_A_Att 0.35
       ${OSC_PREFIX}/SVF_Flt_Cut 0.72

  Waiting for browser connection...
`);

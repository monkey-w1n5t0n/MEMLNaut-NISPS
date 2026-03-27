#!/usr/bin/env -S deno run --allow-net --unstable-net

// NISPS <-> OSC Bridge (bidirectional)
// WebSocket server that bridges the browser webapp and OSC-capable software
// (VCV Rack MEMLNaut module, SuperCollider, etc.).
//
// Webapp -> Bridge -> OSC target (param updates, state, weights)
// OSC target -> Bridge -> Webapp (output values, input values)
//
// Run with Deno:
//   deno run --allow-net bridge.ts
//
// Options:
//   --osc-host 192.168.1.5       Target IP (default: 127.0.0.1)
//   --osc-port 9000              Target port (default: 9000 / VCV MEMLNaut)
//   --osc-prefix /my             Address prefix (default: /nisps)
//   --ws-port 8765               WebSocket listen port (default: 8765)
//   --listen-port 9001           UDP port for incoming OSC (default: 9001)
//   --bundle                     Send OSC bundles instead of individual messages
//
// OSC address format:
//   /nisps/<param_name> <float>   (webapp -> target)
//   /nisps/state <string>         (webapp -> target: full JSON state)
//   /nisps/weights <string>       (webapp -> target: weights JSON)
//   /nisps/output <f...f>         (target -> webapp: output float array)
//   /nisps/input <f...f>          (target -> webapp: input float array)

import { parseArgs } from "jsr:@std/cli@1/parse-args";

// ---- CLI args ----
const args = parseArgs(Deno.args, {
  string: ["osc-host", "osc-port", "osc-prefix", "ws-port", "listen-port"],
  boolean: ["bundle", "help"],
  default: {
    "osc-host": "127.0.0.1",
    "osc-port": "9000",
    "osc-prefix": "/nisps",
    "ws-port": "8765",
    "listen-port": "9001",
    "bundle": false,
    "help": false,
  },
});

if (args.help) {
  console.log(`
NISPS <-> OSC Bridge (bidirectional)

Usage: nisps-osc-bridge [options]

Options:
  --osc-host <ip>        Target IP address (default: 127.0.0.1)
  --osc-port <port>      Target UDP port (default: 9000)
  --osc-prefix <pfx>     OSC address prefix (default: /nisps)
  --ws-port <port>       WebSocket listen port (default: 8765)
  --listen-port <port>   UDP listen port for incoming OSC (default: 9001)
  --bundle               Send OSC bundles instead of individual messages
  --help                 Show this help
`);
  Deno.exit(0);
}

const WS_PORT = parseInt(args["ws-port"]);
const OSC_HOST = args["osc-host"];
const OSC_PORT = parseInt(args["osc-port"]);
const OSC_PREFIX = args["osc-prefix"];
const LISTEN_PORT = parseInt(args["listen-port"]);
const USE_BUNDLES = args.bundle;

// ---- OSC encoding (zero dependencies) ----

function oscPadded(len: number): number {
  return len + (4 - (len % 4)) % 4;
}

function oscString(str: string): Uint8Array {
  const encoder = new TextEncoder();
  const strBytes = encoder.encode(str);
  const len = strBytes.length + 1; // null terminator
  const padded = oscPadded(len);
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

function oscMessageString(address: string, value: string): Uint8Array {
  return concat(oscString(address), oscString(",s"), oscString(value));
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

// ---- OSC decoding ----

function readOscString(buf: Uint8Array, offset: number): [string, number] {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const decoder = new TextDecoder();
  const str = decoder.decode(buf.slice(offset, end));
  const nextOffset = offset + oscPadded(end - offset + 1);
  return [str, nextOffset];
}

function readOscFloat(buf: Uint8Array, offset: number): [number, number] {
  if (offset + 4 > buf.length) return [0, offset + 4];
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
  return [view.getFloat32(0, false), offset + 4];
}

interface ParsedOscMessage {
  address: string;
  types: string;
  args: (number | string)[];
}

function parseOscMessage(buf: Uint8Array): ParsedOscMessage | null {
  if (buf.length < 4) return null;
  let offset = 0;

  const [address, off1] = readOscString(buf, offset);
  if (!address.startsWith("/")) return null;
  offset = off1;

  const [tags, off2] = readOscString(buf, offset);
  if (!tags.startsWith(",")) return null;
  offset = off2;

  const types = tags.slice(1);
  const args: (number | string)[] = [];

  for (const t of types) {
    if (t === "f") {
      const [val, off] = readOscFloat(buf, offset);
      args.push(val);
      offset = off;
    } else if (t === "s") {
      const [val, off] = readOscString(buf, offset);
      args.push(val);
      offset = off;
    }
    // skip unknown types
  }

  return { address, types, args };
}

// ---- UDP sockets ----

// Outgoing: sends OSC to the target (VCV module)
const udpSend = Deno.listenDatagram({ port: 0, transport: "udp", hostname: "0.0.0.0" });
const oscAddr: Deno.NetAddr = { transport: "udp", hostname: OSC_HOST, port: OSC_PORT };

function sendOSC(address: string, value: number): void {
  const msg = oscMessage(address, value);
  udpSend.send(msg, oscAddr);
}

function sendOSCString(address: string, value: string): void {
  const msg = oscMessageString(address, value);
  udpSend.send(msg, oscAddr);
}

function sendOSCBundle(params: [string, number][]): void {
  const messages = params.map(([name, value]) =>
    oscMessage(`${OSC_PREFIX}/${name}`, value)
  );
  const bundle = oscBundle(messages);
  udpSend.send(bundle, oscAddr);
}

// Incoming: listens for OSC from the target (VCV module)
const udpRecv = Deno.listenDatagram({ port: LISTEN_PORT, transport: "udp", hostname: "0.0.0.0" });

// ---- WebSocket server ----
const wsClients: Set<WebSocket> = new Set();

function broadcastToWs(data: string): void {
  for (const ws of wsClients) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    } catch {
      // ignore send errors
    }
  }
}

function handleWs(ws: WebSocket): void {
  wsClients.add(ws);
  console.log(`[ws] Client connected (${wsClients.size} total)`);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "info",
      message: `OSC <-> ${OSC_HOST}:${OSC_PORT} (prefix: ${OSC_PREFIX}, listen: ${LISTEN_PORT})`,
    }));
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data as string);

      // New structured message format: { type, payload }
      if (data && typeof data === "object" && data.type) {
        switch (data.type) {
          case "state":
            // Send full state JSON as OSC string to /nisps/state
            sendOSCString(`${OSC_PREFIX}/state`, JSON.stringify(data.payload));
            return;
          case "weights":
            // Send weights JSON as OSC string to /nisps/weights
            sendOSCString(`${OSC_PREFIX}/weights`, JSON.stringify(data.payload));
            return;
          case "params":
            // Legacy batch format embedded in structured message
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
    } catch (err) {
      console.error("[ws] Bad message:", (err as Error).message);
    }
  };

  ws.onclose = () => {
    wsClients.delete(ws);
    console.log(`[ws] Client disconnected (${wsClients.size} remaining)`);
  };
}

// ---- UDP receive loop (OSC from VCV -> relay to WebSocket clients) ----

async function udpReceiveLoop(): Promise<void> {
  for await (const [data, _addr] of udpRecv) {
    const msg = parseOscMessage(data);
    if (!msg) continue;

    // Relay parsed OSC messages to all connected WebSocket clients
    const wsMsg: Record<string, unknown> = { type: "osc", address: msg.address };

    if (msg.address === `${OSC_PREFIX}/output` || msg.address === "/nisps/output") {
      // Float array of outputs
      wsMsg.type = "outputs";
      wsMsg.values = msg.args.filter((a): a is number => typeof a === "number");
    } else if (msg.address === `${OSC_PREFIX}/input` || msg.address === "/nisps/input") {
      // Float array of inputs
      wsMsg.type = "inputs";
      wsMsg.values = msg.args.filter((a): a is number => typeof a === "number");
    } else {
      // Generic OSC message
      wsMsg.args = msg.args;
    }

    broadcastToWs(JSON.stringify(wsMsg));
  }
}

// Start UDP receive loop
udpReceiveLoop().catch((err) => {
  console.error("[udp] Receive loop error:", err);
});

// Start WebSocket server
Deno.serve({ port: WS_PORT }, (req) => {
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("NISPS OSC Bridge — connect via WebSocket", { status: 200 });
  }
  const { socket, response } = Deno.upgradeWebSocket(req);
  handleWs(socket);
  return response;
});

console.log(`
NISPS <-> OSC Bridge (bidirectional)
────────────────────────────────────
  WebSocket:    ws://localhost:${WS_PORT}
  OSC target:   ${OSC_HOST}:${OSC_PORT}
  OSC listen:   0.0.0.0:${LISTEN_PORT}
  Prefix:       ${OSC_PREFIX}
  Mode:         ${USE_BUNDLES ? "bundles" : "individual messages"}

  Webapp -> VCV:
    params:  [[name, value], ...]  or  { type: "params", payload: [...] }
    state:   { type: "state", payload: <JSON> }
    weights: { type: "weights", payload: <JSON> }

  VCV -> Webapp:
    /nisps/output <f...f>  ->  { type: "outputs", values: [...] }
    /nisps/input  <f...f>  ->  { type: "inputs",  values: [...] }

  Waiting for connections...
`);

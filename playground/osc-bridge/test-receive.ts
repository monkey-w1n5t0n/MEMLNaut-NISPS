#!/usr/bin/env -S deno run --allow-net --unstable-net

// Quick OSC receiver — prints incoming NISPS parameters to the terminal.
// Usage: deno run --allow-net test-receive.ts [--port 57120]

import { parseArgs } from "jsr:@std/cli@1/parse-args";

const args = parseArgs(Deno.args, {
  string: ["port"],
  default: { port: "57120" },
});

const port = parseInt(args.port);
const udp = Deno.listenDatagram({ port, transport: "udp", hostname: "0.0.0.0" });

console.log(`Listening for OSC on UDP port ${port}...\n`);

// Minimal OSC parser
function readOscString(buf: Uint8Array, offset: number): [string, number] {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const str = new TextDecoder().decode(buf.slice(offset, end));
  // Advance past null + padding to 4-byte boundary
  const padded = end + 1;
  return [str, padded + (4 - (padded % 4)) % 4];
}

function parseOscMessage(buf: Uint8Array): { address: string; args: number[] } | null {
  if (buf.length < 8) return null;
  const [address, typeOffset] = readOscString(buf, 0);
  if (buf[typeOffset] !== 0x2C) return null; // ','
  const [typeTag, dataOffset] = readOscString(buf, typeOffset);

  const oscArgs: number[] = [];
  let pos = dataOffset;
  for (let i = 1; i < typeTag.length; i++) {
    if (typeTag[i] === "f") {
      const view = new DataView(buf.buffer, buf.byteOffset + pos, 4);
      oscArgs.push(view.getFloat32(0, false));
      pos += 4;
    } else if (typeTag[i] === "i") {
      const view = new DataView(buf.buffer, buf.byteOffset + pos, 4);
      oscArgs.push(view.getInt32(0, false));
      pos += 4;
    }
  }
  return { address, args: oscArgs };
}

function parseOscBundle(buf: Uint8Array): { address: string; args: number[] }[] {
  // Check for #bundle header
  const header = new TextDecoder().decode(buf.slice(0, 7));
  if (header !== "#bundle") return [];

  const messages: { address: string; args: number[] }[] = [];
  let pos = 16; // skip header (8) + timetag (8)
  while (pos + 4 < buf.length) {
    const size = new DataView(buf.buffer, buf.byteOffset + pos, 4).getUint32(0, false);
    pos += 4;
    if (pos + size > buf.length) break;
    const msg = parseOscMessage(buf.slice(pos, pos + size));
    if (msg) messages.push(msg);
    pos += size;
  }
  return messages;
}

// Bar chart helper
function bar(value: number, width = 30): string {
  const filled = Math.round(value * width);
  return "\x1b[36m" + "█".repeat(filled) + "\x1b[90m" + "░".repeat(width - filled) + "\x1b[0m";
}

let msgCount = 0;
let lastPrint = 0;
const latest = new Map<string, number>();

for await (const [data] of udp) {
  const buf = new Uint8Array(data);
  let messages: { address: string; args: number[] }[];

  // Try bundle first, fall back to single message
  messages = parseOscBundle(buf);
  if (messages.length === 0) {
    const single = parseOscMessage(buf);
    if (single) messages = [single];
  }

  for (const msg of messages) {
    msgCount++;
    const name = msg.address.replace(/^\/nisps\//, "");
    latest.set(name, msg.args[0]);
  }

  // Throttle display to ~10fps
  const now = Date.now();
  if (now - lastPrint < 100) continue;
  lastPrint = now;

  // Clear and redraw
  const lines: string[] = [];
  lines.push(`\x1b[2J\x1b[H\x1b[1mNISPS OSC Receiver\x1b[0m  (${msgCount} messages received)\n`);

  const sorted = [...latest.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, value] of sorted) {
    const v = value.toFixed(3).padStart(5);
    lines.push(`  ${name.padEnd(24)} ${v} ${bar(value)}`);
  }

  lines.push(`\n\x1b[90mCtrl+C to quit\x1b[0m`);
  console.log(lines.join("\n"));
}

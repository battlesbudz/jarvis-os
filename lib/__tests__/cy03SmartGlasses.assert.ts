import assert from "node:assert/strict";
import {
  base64ToBytes,
  classifyCy03Packet,
  createCy03AssistantDebouncer,
  createCy03PacketEventHandler,
  hexToBytes,
  normalizeCy03Hex,
} from "../cy03-smart-glasses";

const idle = "AC-55-00-0C-45-00-00-00-00-00-00-00-00-00-45";
const camera = "AC-55-00-0C-45-01-00-00-00-00-00-00-00-00-46";
const assistant = "AC-55-00-2A-46-4B-41-05-8A-87-BE-BF-82-94-EF-C2-40-35-41-AD-62-C9-9D-DC-93-A5-86-08-DC-55-5E-2A-9A-BA-8B-F0-E8-A8-39-E0-00-00-00-00-00-2A";

assert.equal(normalizeCy03Hex(" ac 55 00 2a "), "AC-55-00-2A");
assert.deepEqual(hexToBytes("AC-55-00-2A"), [0xac, 0x55, 0x00, 0x2a]);
assert.deepEqual(base64ToBytes("rFUAKg=="), [0xac, 0x55, 0x00, 0x2a]);

assert.equal(classifyCy03Packet(hexToBytes(idle)).type, "idle");
assert.equal(classifyCy03Packet(hexToBytes(camera)).type, "camera_button");
assert.equal(classifyCy03Packet(hexToBytes(assistant)).type, "assistant_gesture");
assert.equal(classifyCy03Packet(hexToBytes("AC-55-00-0C-45-09")).type, "unknown");

const debouncer = createCy03AssistantDebouncer(2000);
assert.equal(debouncer.shouldEmit(1000), true);
assert.equal(debouncer.shouldEmit(2500), false);
assert.equal(debouncer.shouldEmit(3001), true);

const events: string[] = [];
const handler = createCy03PacketEventHandler({
  now: () => 10_000,
  onPacketReceived: (packet) => events.push(`packet:${packet.type}:${packet.hex}`),
  onAssistantGestureDetected: () => events.push("assistant"),
  onCameraButtonPressed: () => events.push("camera"),
});
handler.handleBytes(hexToBytes(assistant));
handler.handleBytes(hexToBytes(assistant));
handler.handleBytes(hexToBytes(camera));
handler.handleBytes(hexToBytes("AC-55-00-0C-45-09"));
assert.deepEqual(events, [
  `packet:assistant_gesture:${normalizeCy03Hex(assistant)}`,
  "assistant",
  `packet:assistant_gesture:${normalizeCy03Hex(assistant)}`,
  `packet:camera_button:${normalizeCy03Hex(camera)}`,
  "camera",
  "packet:unknown:AC-55-00-0C-45-09",
]);

console.log("OK: CY03 smart glasses packet classification and assistant debounce rules are stable");

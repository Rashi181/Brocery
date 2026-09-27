import test from "node:test";
import assert from "node:assert/strict";
import { orderReads } from "./readQueue.js";

test("slow failing first object cannot starve an unread second object", () => {
  const tracks = [{id: "chips"}, {id: "oreo"}];
  const readings = new Map([["chips", {attemptedAt: 100, failed: true}]]);
  assert.equal(orderReads(tracks, readings, "chips")[0].id, "oreo");
  readings.set("oreo", {attemptedAt: 200});
  assert.equal(orderReads(tracks, readings, "oreo")[0].id, "chips");
});

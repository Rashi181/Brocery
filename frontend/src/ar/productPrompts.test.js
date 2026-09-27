import test from "node:test";
import assert from "node:assert/strict";
import { productPrompt, readingBox, categoryLabel, categoryAssessments } from "./productPrompts.js";

test("SAM categories display without a Muse response and do not verify ingredients", () => {
  assert.equal(categoryLabel(["food package", "bag of chips"]), "Chips packet");
  assert.equal(categoryLabel(["cookie package"]), "Cookie packet");
  assert.equal(categoryLabel(["cookie package", "bag of chips"]), "Food package");
  const rows = categoryAssessments(["bag of chips"], [
    {id: "chips", item: "chips", avoid: ["dairy"]},
    {id: "oreo", item: "Oreo", avoid: []},
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item_id, "chips");
  assert.equal(rows[0].result.match, false);
  assert.ok(rows[0].result.checklist.every((c) => c.status === "unknown"));
});

test("snack requests target packages rather than printed food", () => {
  assert.equal(productPrompt("chips"), "bag of chips");
  assert.equal(productPrompt("Doritos Nacho Cheese"), "bag of chips");
  assert.equal(productPrompt("original Oreo cookies"), "cookie package");
  assert.equal(productPrompt("Cheez-It crackers"), "cracker package");
  assert.equal(productPrompt("bananas"), "bananas");
  assert.equal(productPrompt("water bottle"), "water bottle");
});

test("reading crop includes surrounding print and stays inside image", () => {
  const box = readingBox([0.2, 0.3, 0.2, 0.4]);
  assert.ok(box[0] < 0.2 && box[1] < 0.3);
  assert.ok(box[0] + box[2] > 0.4 && box[1] + box[3] > 0.7);
  assert.deepEqual(readingBox([0, 0, 1, 1]), [0, 0, 1, 1]);
});

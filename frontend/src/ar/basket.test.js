import test from "node:test";
import assert from "node:assert/strict";
import {purchasedLines,totalCents,requestedPackCount} from "./basket.js";
test("checkout includes only added lines and sums integer cents",()=>{
 const lines=[{status:"purchased",amount_cents:349},{status:"substituted",amount_cents:299},{status:"pending",amount_cents:999},{status:"skipped",amount_cents:999}];
 assert.equal(purchasedLines(lines).length,2);assert.equal(totalCents(lines),648);
});

test("tag adds the requested package count",()=>{
 assert.equal(requestedPackCount("2 bags"),2);
 assert.equal(requestedPackCount("1 carton"),1);
 assert.equal(requestedPackCount("one packet"),1);
});

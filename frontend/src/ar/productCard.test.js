import test from "node:test";
import assert from "node:assert/strict";
import {productCard} from "./productCard.js";
const items = [{id:"chips", item:"chips", avoid:["dairy"]}, {id:"pasta", item:"pasta", avoid:[]}];
test("SAM or Muse guesses cannot attach Oreo to chips before or after recognition", () => {
  const misleading = {assessments:[{item_id:"chips", identity:"pass", result:{match:true}}]};
  assert.deepEqual(productCard(null, misleading, items).shown, []);
  const oreo=productCard({name:"Oreo",matched_item_ids:[]}, misleading, items);
  assert.equal(oreo.outside,true);
  assert.equal(oreo.shown.length,0);
});
test("Gemini chips match shows requester checklist without implying dietary approval", () => {
  const card=productCard({name:"Doritos",matched_item_ids:["chips"]}, null, items);
  assert.equal(card.shown.length,1);
  assert.equal(card.shown[0].result.product_name,"Doritos");
  assert.equal(card.shown[0].result.match,false);
});

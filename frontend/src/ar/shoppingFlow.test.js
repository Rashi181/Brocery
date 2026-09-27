import test from "node:test";
import assert from "node:assert/strict";
import {pendingRequests, requestedProducts, checkoutLines} from "./shoppingFlow.js";
test("unrequested packets stay hidden while wanted items from another aisle remain eligible", () => {
  const items=pendingRequests([{items:[{id:"chips"}]},{items:[{id:"milk"},{id:"done"}]}],
    [{item_id:"chips",status:"pending"},{item_id:"milk",status:"pending"},{item_id:"done",status:"confirmed"}]);
  const products=requestedProducts([{name:"Oreo",matched_item_ids:[]},{name:"Milk",matched_item_ids:["milk"]},
    {name:"old",matched_item_ids:["done"]}],items);
  assert.deepEqual(products.map((p)=>p.name),["Milk"]);
});
test("checkout excludes pending and skipped requests", () => {
  assert.deepEqual(checkoutLines(["pending","skipped","purchased","substituted"].map((status)=>({status}))).map((l)=>l.status),["purchased","substituted"]);
});

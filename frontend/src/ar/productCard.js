import {categoryAssessments, productPrompt} from "./productPrompts.js";

// SAM locates regions. Only the independent identity response assigns requests.
export function productCard(identity, reading, items) {
  if (!identity) return {title: "Identifying product…", shown: [], outside: false};
  const matched = items.filter((i) => identity.matched_item_ids.includes(i.id));
  const shown = matched.map((item) => {
    const assessment = reading?.assessments?.find((a) => a.item_id === item.id);
    const fallback = categoryAssessments([productPrompt(item.item)], [item])[0];
    const selected = assessment || fallback;
    return {...selected, result: {...selected.result, product_name: identity.name}};
  });
  return {title: identity.name, shown, outside: matched.length === 0};
}

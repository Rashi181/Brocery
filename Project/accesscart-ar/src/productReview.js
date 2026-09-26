export function budgetReview(item, label) {
  if (item?.max_budget == null) return 'No budget specified.'
  if (label.price == null) return 'Budget unverified: no readable price.'
  if (!item.currency || !label.currency || item.currency !== label.currency || !/^[A-Z]{3}$/.test(label.currency)) return 'Budget unverified: currency is missing, ambiguous, or different.'
  if (label.price_basis !== 'single_package' || item.budget_scope !== 'per_unit') return 'Budget unverified: confirm package size and price basis.'
  return (label.price <= item.max_budget ? 'Visible price is within' : 'Visible price exceeds') + ' the per-unit budget. Confirm this is the requested size/unit.'
}

// Conservative checks of explicit allergen declarations, not a safety classifier.
const restrictionRules = [
  { request: /^(?:no dairy|dairy free|no milk|milk free|avoid dairy|avoid milk)$/, ingredient: /\bmilk\b/i },
  { request: /^(?:no peanuts?|peanut free|avoid peanuts?)$/, ingredient: /\bpeanuts?\b/i },
  { request: /^(?:no soy|soy free|avoid soy)$/, ingredient: /\b(?:soy|soya|soybeans?)\b/i },
  { request: /^(?:no wheat|wheat free|avoid wheat)$/, ingredient: /\bwheat\b/i },
  { request: /^(?:no eggs?|egg free|avoid eggs?)$/, ingredient: /\beggs?\b/i },
  { request: /^(?:no sesame|sesame free|avoid sesame)$/, ingredient: /\bsesame\b/i },
]

export function restrictionReview(restrictions, label) {
  // Use only ingredient evidence; product names and unrelated visible text do not count.
  const text = label.ingredients_text ?? ''
  const declarations = []
  for (const clause of text.split(/[.!;\n]+/)) {
    // OCR often loses the line break before an allergen declaration.
    for (const match of clause.matchAll(/\b(?:contains|may contain)\s+[^.!;\n]+/gi)) {
      const prefix = clause.slice(0, match.index).trim()
      // Avoid turning negated or conditional prose into a positive declaration.
      if (/\b(?:no|not|never|without|if|whether)\b/i.test(prefix)) continue
      declarations.push(match[0].trim())
    }
  }
  return restrictions.map(restriction => {
    const normalized = restriction.toLowerCase().replace(/[‐‑–—-]/g, ' ').replace(/\s+/g, ' ').trim()
    const rule = restrictionRules.find(candidate => candidate.request.test(normalized))
    const unknown = { restriction, status:'unknown', evidence:null,
      message: !rule ? 'This restriction needs manual review.' : !text.trim() ? 'Ingredient evidence is missing or unreadable.' : 'No clear conflicting allergen declaration found. This does not establish safety.' }
    if (!rule) return unknown
    let possible = null
    for (const declaration of declarations) {
      // Require an explicit declaration. Do not match “does not contain”, “free from”,
      // ingredient descriptions such as coconut milk, or mixed/negated assertions.
      const match = declaration.match(/^(?:allergens?\s*:\s*)?(contains|may contain)\s+(.+)$/i)
      if (!match || /\b(?:no|not|without|free|except|coconut|almond|oat|rice)\b/i.test(match[2])) continue
      if (!rule.ingredient.test(match[2])) continue
      if (match[1].toLowerCase() === 'contains') return { restriction, status:'conflict', evidence:declaration, message:'Conflicts with your request: the extracted label declares this allergen. Verify the quote on the package.' }
      possible = { restriction, status:'possible', evidence:declaration, message:'Possible conflict: the extracted label says “may contain”. Verify the warning on the package.' }
    }
    return possible ?? unknown
  })
}

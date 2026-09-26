import test from 'node:test'
import assert from 'node:assert/strict'
import { budgetReview } from './productReview.js'
const item = { max_budget:5, currency:'USD', budget_scope:'per_unit' }
const label = { price:4, currency:'USD', price_basis:'single_package' }
test('price comparison respects threshold', () => {
  assert.match(budgetReview(item, label), /within/)
  assert.match(budgetReview(item, {...label, price:5}), /within/)
  assert.match(budgetReview(item, {...label, price:6}), /exceeds/)
})
test('missing or incomparable evidence stays unverified', () => {
  for (const change of [{price:null}, {currency:'$'}, {currency:'EUR'}, {currency:null}, {price_basis:'other'}, {price_basis:'unknown'}]) {
    assert.match(budgetReview(item, {...label, ...change}), /unverified/)
  }
  assert.match(budgetReview({...item,budget_scope:'item_total'}, label), /unverified/)
  assert.match(budgetReview({...item,max_budget:null}, label), /No budget/)
})

import { restrictionReview } from './productReview.js'
const check = (text, restriction='No dairy') => restrictionReview([restriction], {ingredients_text:text})[0]
test('explicit milk declaration conflicts with no dairy with original evidence', () => {
  const result = check('Ingredients: flour, cheese. CONTAINS WHEAT, MILK AND SOY INGREDIENTS.')
  assert.equal(result.status, 'conflict')
  assert.equal(result.evidence, 'CONTAINS WHEAT, MILK AND SOY INGREDIENTS')
})
test('may contain is a possible conflict, not confirmed presence', () => {
  assert.equal(check('May contain peanuts.', 'Peanut-free').status, 'possible')
  assert.equal(check('May contain milk. Contains milk.').status, 'conflict')
})
test('absence, negation, substitutes, unsupported restrictions never pass as safe', () => {
  for (const text of [null, '', 'Ingredients: potatoes, salt.', 'Does not contain milk.', 'Milk-free.', 'Contains coconut milk.', 'Contains soy, not milk.']) {
    assert.equal(check(text).status, 'unknown')
  }
  assert.equal(check('Contains wheat.', 'Gluten-free').status, 'unknown')
  assert.equal(check('Contains milk.', 'Low sugar').status, 'unknown')
  assert.equal(restrictionReview(['No dairy'], {visible_text:'Contains milk.', ingredients_text:null})[0].status,'unknown')
})
test('each requested restriction gets its own result', () => {
  assert.deepEqual(restrictionReview(['No dairy','Peanut-free'], {ingredients_text:'Contains milk.'}).map(value => value.status), ['conflict','unknown'])
})

test('inline allergen declaration survives missing OCR line breaks and punctuation', () => {
  const text = 'INGREDIENTS: ENRICHED CORN MEAL (CORN FERROUS SULFATE, NIACIN, THIAMIN MON RIBOFLAVIN, FOLIC ACID), VEGETABLE OIL (CO AND/OR SUNFLOWER OIL), WHEY, CHEDDAR C CHEESE CULTURES, SALT, ENZYMES), S MALTODEXTRIN, NATURAL AND ARTIFICIAL FLA PROTEIN CONCENTRATE, MONOSODIUM GLUTAM ACID, CITRIC ACID, AND ARTIFICIAL COLOR (YELLO CONTAINS MILK INGREDIENTS.'
  const result = check(text)
  assert.equal(result.status,'conflict')
  assert.equal(result.evidence,'CONTAINS MILK INGREDIENTS')
  assert.equal(check('Ingredients: corn, oil contains milk ingredients').status,'conflict')
  assert.equal(check('Ingredients: corn, oil MAY CONTAIN MILK').status,'possible')
})
test('embedded negated and conditional declarations are not positive evidence', () => {
  for (const text of ['This never contains milk', 'Check whether this contains milk', 'Avoid if this contains milk', 'This contains no milk']) {
    assert.equal(check(text).status,'unknown')
  }
})

import { useEffect, useRef, useState } from 'react'
import { budgetReview, restrictionReview } from './productReview.js'

export default function ProductReview({ image, item, disabled }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [label, setLabel] = useState(null)
  const active = useRef(null)
  useEffect(() => () => active.current?.abort(), [])
  async function read() {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true); setLabel(null); setStatus('Reading visible label…')
    const timer = setTimeout(() => controller.abort(), 100000)
    try {
      const blob = await (await fetch(image)).blob()
      const response = await fetch('/api/product/read', { method:'POST', headers:{'Content-Type':'image/jpeg'}, body:blob, signal:controller.signal })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.label) throw new Error(data?.detail || 'Label reading failed')
      if (controller.signal.aborted) return
      setLabel(data.label)
      setStatus('Read in ' + (data.elapsed_ms / 1000).toFixed(1) + 's. Check against the photo.')
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error.message)
      else setStatus('Reading cancelled or timed out. Retry when ready.')
    } finally { clearTimeout(timer); active.current = null; setBusy(false) }
  }
  return <section className="chat-item">
    <strong>TEST 14 · READ PRODUCT LABEL</strong>
    <p className="capture-status">Fill the photo with one readable label. This sends the photo to Muse and may use API credits.</p>
    <button className="capture-button" disabled={busy || disabled} onClick={read}>{busy ? 'READING…' : 'READ LABEL WITH MUSE'}</button>
    <p className="capture-status" role="status">{status}</p>
    {label && <>
      <p>Label name: {label.product_name ?? 'Unreadable / unknown'}</p>
      <p>Visible price: {label.price == null ? 'Not shown / unreadable' : (label.currency ?? 'Unknown currency') + ' ' + label.price}</p>
      {item && <>
        <p>Requested: {item.product} for {item.requester ?? 'Unknown'}. Confirm the name and package size yourself.</p>
        <p>{budgetReview(item, label)}</p>
        {item.preferences.length > 0 && <p>Preferences to check: {item.preferences.join('; ')}</p>}
        {restrictionReview(item.restrictions, label).map((check, index) => <div key={index} className={'restriction-check restriction-' + check.status}>
          <strong>{check.status === 'conflict' ? 'CONFLICT' : check.status === 'possible' ? 'POSSIBLE CONFLICT' : 'UNVERIFIED'} · {check.restriction}</strong>
          <p>{check.message}</p>
          {check.evidence && <blockquote>{check.evidence}</blockquote>}
        </div>)}
      </>}
      <p>Ingredient text: {label.ingredients_text ?? 'Not visible / unreadable'}</p>
      <p className="capture-status">A photo does not establish allergen safety. No item has been added to the cart.</p>
      {label.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
      <details><summary>Visible text evidence</summary><pre className="chat-json">{label.visible_text || 'No readable text.'}</pre></details>
    </>}
  </section>
}

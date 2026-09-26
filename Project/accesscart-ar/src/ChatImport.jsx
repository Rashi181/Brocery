import { useEffect, useRef, useState } from 'react'

const SAMPLE = '[09:00] Priya: Please get 2 cartons of unsweetened oat milk. Max USD 5 per carton. No dairy.\n[09:01] Alex: Get 3 bananas.\n[09:02] Priya: Actually just 1 carton, same budget.\n[09:03] Alex: Peanut-free snacks too, brand does not matter.'

export default function ChatImport({ onUseList, disabled = false }) {
  const [chat, setChat] = useState('')
  const [result, setResult] = useState(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const controller = useRef(null)
  const revision = useRef(0)
  useEffect(() => () => { revision.current++; controller.current?.abort() }, [])
  function update(value) {
    revision.current++
    setChat(value); setResult(null); setStatus('')
  }
  async function loadFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const version = ++revision.current
    setResult(null)
    if (file.size > 100000) { setStatus('Use a text export smaller than 100 KB.'); return }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (version !== revision.current) return
      if (text.length > 20000) { setStatus('Use an excerpt of at most 20,000 characters.'); return }
      update(text)
    } catch { if (version === revision.current) setStatus('Could not read this file. Choose a UTF-8 .txt export.') }
  }
  async function parse() {
    if (controller.current) return
    revision.current++
    const request = new AbortController()
    controller.current = request
    setBusy(true); setResult(null); setStatus('Reading shopping requests…')
    const timeout = setTimeout(() => request.abort(), 100000)
    try {
      const response = await fetch('/api/chat/parse', { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: chat, signal: request.signal })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Chat parsing failed')
      setResult(data.contract)
      setStatus('Draft ready in ' + (data.elapsed_ms / 1000).toFixed(1) + 's. Review it against your chat.')
    } catch (error) {
      setStatus(error.name === 'AbortError' ? 'Request timed out. Try a shorter excerpt.' : error.message)
    } finally { clearTimeout(timeout); controller.current = null; setBusy(false) }
  }
  return <details className="chat-import">
    <summary>TEST 12 · SHOPPING CHAT</summary>
    <p className="capture-status">Paste a chat or choose a UTF-8 .txt export. Parsing sends the text to Meta Muse Spark and may use API credits. No AR session needed.</p>
    <input aria-label="Upload chat text file" type="file" accept=".txt,text/plain" disabled={busy} onChange={loadFile} />
    <textarea aria-label="Shopping chat" className="segment-input" rows={6} maxLength={20000} value={chat} disabled={busy} onChange={e => update(e.target.value)} placeholder="Paste shopping requests here" />
    <button className="capture-button" disabled={busy} onClick={() => update(SAMPLE)}>LOAD SAMPLE CHAT</button>
    <button className="capture-button" disabled={busy || !chat.trim()} onClick={parse}>{busy ? 'PARSING…' : 'PARSE WITH MUSE'}</button>
    <div className="capture-status" role="status">{status}</div>
    {result && <div>
      <p className="capture-status">Draft only — nothing has been purchased or added to a cart.</p>
      <button className="capture-button" disabled={disabled || !result.items.length} onClick={() => onUseList(result)}>USE THIS LIST FOR AR</button>
      {result.items.length === 0 && <p>No shopping requests found.</p>}
      {result.items.map((item, index) => <article className="chat-item" key={index}>
        <strong>{item.product}</strong>
        <div>For: {item.requester ?? 'Unknown'}</div>
        <div>Quantity: {item.quantity ?? 'Not specified'} {item.unit ?? ''}</div>
        <div>Budget: {item.max_budget == null ? 'Not specified' : (item.currency ?? 'Currency unknown') + ' ' + item.max_budget + ' (' + (item.budget_scope === 'per_unit' ? 'per unit' : item.budget_scope === 'item_total' ? 'item total' : 'scope unknown') + ')'}</div>
        {item.preferences.length > 0 && <div>Preferences: {item.preferences.join('; ')}</div>}
        {item.restrictions.length > 0 && <div>Restrictions: {item.restrictions.join('; ')}</div>}
        {item.needs_clarification.map((q, i) => <p key={i}>Clarify: {q}</p>)}
        <details><summary>Source evidence</summary>{item.evidence.map((q, i) => <blockquote key={i}>{q}</blockquote>)}</details>
      </article>)}
      {result.shared_constraints.map((q, i) => <p key={i}>Shared constraint: {q}</p>)}
      {result.unresolved_questions.map((q, i) => <p key={i}>Open question: {q}</p>)}
      <details><summary>Structured JSON</summary><pre className="chat-json">{JSON.stringify(result, null, 2)}</pre></details>
    </div>}
  </details>
}

import {useEffect, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {useStore} from "../store";
import {api} from "../api";
import ARScene from "../ar/ARScene";
import {cropImage} from "../ar/images";
import {productCard} from "../ar/productCard";
import BudgetBar from "../components/BudgetBar";
import DecisionCard from "../components/DecisionCard";
import {requestedPackCount} from "../ar/basket";
import {pendingRequests, requestedProducts} from "../ar/shoppingFlow";

export default function AnchoredShoppingScreen() {
  const state=useStore(), nav=useNavigate(), overlay=useRef(null), xr=useRef(null);
  const lifecycle=useRef(0), controllers=useRef(new Set()), serial=useRef(0), reading=useRef(false);
  const [active,setActive]=useState(false), [products,setProducts]=useState([]);
  const [error,setError]=useState(""), [status,setStatus]=useState("Start AR once; product recognition is automatic.");
  const [selected,setSelected]=useState(null), [decision,setDecision]=useState(null);
  const [checks,setChecks]=useState({});
  const adding=useRef(new Set());
  const [addingId,setAddingId]=useState(null);
  const aisle=state.aisles.find((a)=>a.aisle_no===state.currentAisleNo);
  const items=pendingRequests(state.aisles,state.lines);
  const pendingKey=items.map((i)=>i.id).join(",");
  useEffect(()=>{xr.current?.retainItems(pendingKey.split(",").filter(Boolean));},[pendingKey]);
  useEffect(()=>()=>{lifecycle.current++; controllers.current.forEach((c)=>c.abort());},[]);
  function signal(timeout) {
    const control=new AbortController(); controllers.current.add(control);
    return {control, signal:AbortSignal.any([control.signal,AbortSignal.timeout(timeout)])};
  }
  function onActive(value) {
    setActive(value);
    if (!value) {
      lifecycle.current++; controllers.current.forEach((c)=>c.abort());
      setProducts([]); setSelected(null); setChecks({});
    }
  }
  async function inspectIngredients(d, photo, token) {
    if(reading.current || !d.matched_item_ids.length || d.view!=="ingredients") return;
    reading.current=true;
    const {control,signal:abort}=signal(80000);
    try {
      const image=await cropImage(photo,d.bbox);
      const result=await api.observe({trip_id:state.tripId,track_id:d.detection_id,
        sequence:++serial.current,item_ids:d.matched_item_ids,image_b64:image},abort);
      if(token===lifecycle.current) setChecks((previous)=>({...previous,[d.detection_id]:{...result,image}}));
    } catch(e) {if(token===lifecycle.current && e.name!=="AbortError") setError(e.message);}
    finally {reading.current=false;controllers.current.delete(control);}
  }
  async function scan(photo, pose) {
    if(!items.length || decision || document.hidden) return;
    const token=lifecycle.current, sequence=++serial.current;
    const {control,signal:abort}=signal(35000);
    setStatus("Gemini is identifying the visible products…");
    try {
      const result=await api.scene({trip_id:state.tripId,track_id:"ar-scene",sequence,
        item_ids:items.slice(0,100).map((i)=>i.id),image_b64:photo},abort);
      if(token!==lifecycle.current || result.sequence!==sequence) return;
      const detections=requestedProducts(result.products,pendingRequests(useStore.getState().aisles,useStore.getState().lines)).map((p,index)=>{
        const [y1,x1,y2,x2]=p.box_2d;
        return {...p, bbox:[x1/1000,y1/1000,(x2-x1)/1000,(y2-y1)/1000],
          detection_id:`scene-${sequence}-${index}`, prompt:p.category, image:photo,
          subtitle:p.demo_quote ? `$${(p.demo_quote.unit_cents/100).toFixed(2)} demo / pack · tap to add` : "Price unavailable · retrying"};
      });
      setProducts(detections); setError("");
      await xr.current?.place(detections,items,pose);
      setStatus(detections.length ? `${detections.length} finds for your household · tap a tag to shop` : "Looking for items on your household list…");
      const ingredients=detections.find((d)=>d.view==="ingredients" && d.matched_item_ids.length);
      if(ingredients) void inspectIngredients(ingredients,photo,token);
    } catch(e) {
      if(token===lifecycle.current && e.name!=="AbortError") {setError(e.message);setStatus("Recognition will retry automatically");}
      return {retryDelay: /quota|rate limit/i.test(e.message) ? 15000 : 5000};
    } finally {controllers.current.delete(control);}
  }
  async function addTag(product) {
    const current=useStore.getState();
    const item=pendingRequests(current.aisles,current.lines).find(i=>product.matched_item_ids.includes(i.id));
    if(!item || adding.current.has(item.id)) return;
    if(!product.demo_quote) {setError("Demo price unavailable. Keep the product visible for another scan.");return;}
    adding.current.add(item.id);setAddingId(item.id);setError("");
    try {
      const cart=await api.demoAdd({trip_id:current.tripId,item_id:item.id,
        quote_id:product.demo_quote.id,quantity:requestedPackCount(item.quantity),acknowledge_unverified:true});
      current.applyCart(cart);
      setSelected(null);setDecision(null);
      setStatus(`Added ${product.name} for ${item.requester}`);
      if(navigator.vibrate)navigator.vibrate(35);
    }catch(e){setError(e.message);}
    finally{adding.current.delete(item.id);setAddingId(null);}
  }
  async function leave(path) {await xr.current?.end();nav(path);}
  const card=selected && productCard(selected,checks[selected.detection_id],items);
  if(!state.tripId) return <main className="page"><button onClick={()=>nav("/")}>Import your shopping list</button></main>;
  return <div ref={overlay} className={`ar-root ${active?"active":""}`}>
    <ARScene ref={xr} overlay={overlay} automatic paused={!!decision} onCapture={scan}
      onActive={onActive} onPick={addTag}/>
    <header className="ar-top">
      <div className="row justify-between"><button onClick={()=>leave("/aisles")}>← Aisles</button>
        <span className="eyebrow">{aisle?.aisle} · AR</span><button className="shop-checkout-link" onClick={()=>leave("/checkout")}>Checkout →</button></div>
      <BudgetBar compact/>
    </header>
    <section className="ar-bottom panel shopping-sheet" style={{maxHeight:decision?"65vh":"40vh",overflowY:"auto"}}>
      <small role="status">{status}</small>
      {error && <p role="alert">{error}</p>}
      {!active && <><p>Labels attach to shelf positions. Move slowly to map the surface.</p>
        <button onClick={()=>nav("/ar/camera")}>Use standard camera instead</button></>}
      {!selected && <div className="row shop-finds" style={{flexWrap:"wrap"}}>{requestedProducts(products,items).map((d)=><button key={d.detection_id} disabled={!!addingId} onClick={()=>addTag(d)}>
        <span>＋</span> {d.name}{d.demo_quote && ` · $${(d.demo_quote.unit_cents/100).toFixed(2)} demo`}</button>)}</div>}
      <small>Tag tap adds the requested package count at a demo price. Ingredients remain unverified.</small>
      <button className="shop-add" onClick={()=>leave("/checkout")}>Proceed to checkout · {state.lines.filter(l=>["purchased","substituted"].includes(l.status)).length} items →</button>
      {!selected && products.length>0 && <details><summary>Ingredient checks / product details</summary>{requestedProducts(products,items).map(d=><button key={d.detection_id} onClick={()=>setSelected(d)}>{d.name} · details</button>)}</details>}
      {selected && !decision && <>
        <button className="shop-close" onClick={()=>setSelected(null)}>Close ×</button><small className="eyebrow">A FIND FOR YOUR HOUSEHOLD</small><h3>{selected.name}</h3><small>{selected.category}</small>
        {card.shown.map((a)=>{const item=items.find((i)=>i.id===a.item_id);return <div key={item.id}>
          <b>For {item.requester} · {item.item}</b><ul>{a.result.checklist.map((c,i)=><li key={i}>{c.status==="pass"?"✓":c.status==="fail"?"×":"?"} {c.text}</li>)}</ul>
          <button className="shop-add" onClick={async()=>{try {setDecision({item,result:a.result,image:await cropImage(selected.image,selected.bbox)});} catch(e) {setError(e.message);}}}>Review ingredient checks <span>→</span></button>
        </div>;})}
      </>}
      {decision && <DecisionCard {...decision} live onRetake={()=>setDecision(null)} onDone={(message)=>{setDecision(null);setSelected(null);setStatus(message);}}/>}
    </section>
  </div>;
}

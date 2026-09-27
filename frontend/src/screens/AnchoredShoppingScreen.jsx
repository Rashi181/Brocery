import {useEffect, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {useStore} from "../store";
import {api} from "../api";
import ARScene from "../ar/ARScene";
import {cropImage} from "../ar/images";
import {productCard} from "../ar/productCard";
import BudgetBar from "../components/BudgetBar";
import DecisionCard from "../components/DecisionCard";

export default function AnchoredShoppingScreen() {
  const state=useStore(), nav=useNavigate(), overlay=useRef(null), xr=useRef(null);
  const lifecycle=useRef(0), controllers=useRef(new Set()), serial=useRef(0), reading=useRef(false);
  const [active,setActive]=useState(false), [products,setProducts]=useState([]);
  const [error,setError]=useState(""), [status,setStatus]=useState("Start AR once; product recognition is automatic.");
  const [selected,setSelected]=useState(null), [decision,setDecision]=useState(null);
  const [checks,setChecks]=useState({});
  const aisle=state.aisles.find((a)=>a.aisle_no===state.currentAisleNo);
  const items=aisle?.items.filter((i)=>state.lines.some((l)=>l.item_id===i.id && l.status==="pending")) || [];
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
        item_ids:items.slice(0,12).map((i)=>i.id),image_b64:photo},abort);
      if(token!==lifecycle.current || result.sequence!==sequence) return;
      const detections=result.products.map((p,index)=>{
        const [y1,x1,y2,x2]=p.box_2d;
        return {...p, bbox:[x1/1000,y1/1000,(x2-x1)/1000,(y2-y1)/1000],
          detection_id:`scene-${sequence}-${index}`, prompt:p.category, image:photo,
          subtitle:p.matched_item_ids.length?"On your list · tap for checklist":"Not on this aisle's list"};
      });
      setProducts(detections); setError("");
      await xr.current?.place(detections,items,pose);
      setStatus(`${detections.length} products recognised · shelf labels anchored when a surface is found`);
      const ingredients=detections.find((d)=>d.view==="ingredients" && d.matched_item_ids.length);
      if(ingredients) void inspectIngredients(ingredients,photo,token);
    } catch(e) {
      if(token===lifecycle.current && e.name!=="AbortError") {setError(e.message);setStatus("Recognition will retry automatically");}
    } finally {controllers.current.delete(control);}
  }
  async function leave(path) {await xr.current?.end();nav(path);}
  const card=selected && productCard(selected,checks[selected.detection_id],items);
  if(!state.tripId) return <main className="page"><button onClick={()=>nav("/")}>Import your shopping list</button></main>;
  return <div ref={overlay} className={`ar-root ${active?"active":""}`}>
    <ARScene ref={xr} overlay={overlay} automatic paused={!!decision} onCapture={scan}
      onActive={onActive} onPick={setSelected}/>
    <header className="ar-top">
      <div className="row justify-between"><button onClick={()=>leave("/aisles")}>← Aisles</button>
        <span className="eyebrow">{aisle?.aisle} · AR</span><button onClick={()=>leave("/cart")}>Basket</button></div>
      <BudgetBar compact/>
    </header>
    <section className="ar-bottom panel" style={{maxHeight:"40vh",overflowY:"auto"}}>
      <small role="status">{status}</small>
      {error && <p role="alert">{error}</p>}
      {!active && <><p>Labels attach to shelf positions. Move slowly to map the surface.</p>
        <button onClick={()=>nav("/ar/camera")}>Use standard camera instead</button></>}
      {!selected && <div className="row" style={{flexWrap:"wrap"}}>{products.map((d)=><button key={d.detection_id} onClick={()=>setSelected(d)}>
        {d.name} · {d.matched_item_ids.length?"On list":"Not on list"}</button>)}</div>}
      {selected && !decision && <>
        <button onClick={()=>setSelected(null)}>Close details</button><h3>{selected.name}</h3><small>{selected.category}</small>
        {card.outside && <p>Not on your list for this aisle.</p>}
        {card.shown.map((a)=>{const item=items.find((i)=>i.id===a.item_id);return <div key={item.id}>
          <b>For {item.requester} · {item.item}</b><ul>{a.result.checklist.map((c,i)=><li key={i}>{c.status==="pass"?"✓":c.status==="fail"?"×":"?"} {c.text}</li>)}</ul>
          <button onClick={async()=>setDecision({item,result:a.result,image:await cropImage(selected.image,selected.bbox)})}>Add to cart</button>
        </div>;})}
      </>}
      {decision && <DecisionCard {...decision} live onRetake={()=>setDecision(null)} onDone={(message)=>{setDecision(null);setSelected(null);setStatus(message);}}/>}
    </section>
  </div>;
}

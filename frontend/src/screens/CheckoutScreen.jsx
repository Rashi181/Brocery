import {useEffect,useState} from "react";
import {useNavigate} from "react-router-dom";
import {useStore} from "../store";
import {purchasedLines,totalCents} from "../ar/basket";
export default function CheckoutScreen(){
 const nav=useNavigate();
 const {tripId,lines,refreshCart}=useStore();
 const [error,setError]=useState("");
 useEffect(()=>{if(tripId)refreshCart().catch(e=>setError(e.message));},[tripId,refreshCart]);
 const added=purchasedLines(lines);
 return <main className="page pb-32">
  <button onClick={()=>nav("/cart")}>← Basket</button>
  <p className="eyebrow mt-6">THE BROCERY CHECKOUT</p><h1>Your bros’<span className="h1-accent">little essentials.</span></h1>
  {error&&<p className="error" role="alert">{error}</p>}
  {!added.length?<section className="panel"><h2>Your basket is empty</h2><button onClick={()=>nav(tripId?"/aisles":"/")}>Start shopping</button></section>:
   <div className="stack">{added.map(l=><article className="panel" key={l.item_id}>
    <div className="item-head"><strong>{l.product_name||l.requested}</strong><strong>${(l.amount_cents/100).toFixed(2)}</strong></div>
    <p className="muted">{l.purchased_quantity||l.quantity} · for {l.shared?"Household":l.requester}</p>
    {l.unit_price!=null&&<small>${l.unit_price.toFixed(2)} per package</small>}
    {l.price_source&&<p className="muted">{l.price_source} · not a real store price</p>}
   </article>)}</div>}
  <section className="panel mt-6"><div className="item-head"><h2>Total</h2><h2>${(totalCents(lines)/100).toFixed(2)}</h2></div><small>{added.length} added requests · USD · no payment collected</small></section>
  <footer className="dock"><button className="primary cta" disabled>Split and pay</button><small className="muted">Demo checkout · payment and splitting are not connected.</small></footer>
 </main>;
}

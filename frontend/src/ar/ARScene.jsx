import { useEffect, useRef, useState, useImperativeHandle } from "react";
import * as THREE from "three";
import { detectionRay } from "./detectionRay";
import { cameraPixelsToJpeg, readCameraPixels } from "./cameraFrame";
import {createHandReader} from "./xrHandFrame";
import {handPointer, resizeGesture} from "./liveMath";

function label(detection, requester) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(250,247,235,.97)";
  ctx.beginPath();
  ctx.roundRect(0, 0, 768, 256, 28);
  ctx.fill();
  ctx.strokeStyle = "#b9cbb6"; ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#275a42";
  ctx.font = "600 19px Arial, sans-serif";
  ctx.fillText("ACCESSCART  /  YOUR DAILY FINDS", 32, 36);
  const title=detection.name || detection.prompt;
  let fontSize=46;
  do {ctx.font=`bold ${fontSize}px Georgia, serif`;fontSize--;} while(ctx.measureText(title).width>698 && fontSize>25);
  ctx.fillText(title,32,96,698);
  ctx.fillStyle = "#526458";
  ctx.font = "26px Arial, sans-serif";
  ctx.fillText(requester ? `Picked for ${requester}` : "From your shopping list",32,140,698);
  ctx.fillStyle="#1e4935";ctx.beginPath();ctx.roundRect(24,168,720,66,22);ctx.fill();
  ctx.fillStyle="#f4f7e8";ctx.font="600 25px Arial, sans-serif";
  ctx.fillText(detection.subtitle || "Double-tap to inspect",46,211,665);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: true,
      depthWrite: false,
      transparent: true,
    }),
  );
  sprite.scale.set(0.36, 0.12, 1);
  sprite.position.y = 0.14;
  sprite.userData.detection = detection;
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.add(sprite);
  return group;
}

// Camera access and hit-test ray mapping retained from Alex's device-tested AR.
export default function ARScene({
  ref,
  overlay,
  onCapture,
  onPick,
  onActive,
  onAnchored,
  automatic = false,
  paused = false,
}) {
  const host = useRef(null),
    engine = useRef(null),
    callbacks = useRef(null);
  const [status, setStatus] = useState(
    "Start AR on your phone, or use the label camera.",
  );
  const [active, setActive] = useState(false);
  useEffect(() => {
    callbacks.current = { onCapture, onPick, onActive, onAnchored, automatic, paused };
  }, [onCapture, onPick, onActive, onAnchored, automatic, paused]);
  useImperativeHandle(
    ref,
    () => ({
      capture: () => engine.current?.capture(),
      place: (detections, items, pose) => engine.current?.place(detections, items, pose),
      end: () => engine.current?.end(),
      clear: () => engine.current?.clear(),
      remove: (prompt) => engine.current?.remove(prompt),
      retainItems: (ids) => engine.current?.retainItems(ids),
    }),
    [],
  );
  useEffect(() => {
    let disposed = false,
      space = null,
      binding = null,
      framebuffer = null,
      captured = null,
      requested = false,
      version = 0;
    let captureBusy = false, nextCapture = 0;
    let handWorker=null, handReader=null, handsReady=false, handsBusy=false, nextHands=0, gestureState=null;
    let pending = [],
      anchors = [];
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(
        70,
        innerWidth / innerHeight,
        0.01,
        30,
      );
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType("local");
    const element = host.current;
    element.appendChild(renderer.domElement);
    const disposeObject = (object) =>
      object.traverse((child) => {
        child.material?.map?.dispose();
        child.material?.dispose();
      });
    function clear() {
      version++;
      pending.forEach((p) => p.source.cancel());
      pending = [];
      anchors.forEach((a) => {
        a.anchor.delete();
        scene.remove(a.object);
        disposeObject(a.object);
      });
      anchors = [];
    }
    function ended() {
      clear();
      space = null;
      binding = null;
      captured = null;
      requested = false;
      captureBusy = false;
      handWorker?.terminate(); handWorker=null; handReader?.dispose();handReader=null;
      handsReady=false; handsBusy=false; gestureState=null;
      if (framebuffer) renderer.getContext().deleteFramebuffer(framebuffer);
      framebuffer = null;
      if (!disposed) {
        setActive(false);
        callbacks.current?.onActive(false);
        setStatus("AR paused. Start AR to scan and anchor again.");
      }
    }
    const controls = {
      retainItems(ids) {
        if(!callbacks.current?.automatic) return;
        const wanted=new Set(ids);
        const keep=(d)=>d.matched_item_ids?.some((id)=>wanted.has(id));
        pending.filter((p)=>!keep(p.d)).forEach((p)=>p.source.cancel());
        pending=pending.filter((p)=>keep(p.d));
        anchors.filter((a)=>!keep(a.object.children[0].userData.detection)).forEach((a)=>{
          a.anchor.delete();scene.remove(a.object);disposeObject(a.object);
        });
        anchors=anchors.filter((a)=>keep(a.object.children[0].userData.detection));
      },
      async start() {
        try {
          if (
            !navigator.xr ||
            !(await navigator.xr.isSessionSupported("immersive-ar"))
          )
            throw new Error(
              "AR unavailable here. Use the label camera on HTTPS.",
            );
          const session = await navigator.xr.requestSession("immersive-ar", {
            requiredFeatures: [
              "hit-test",
              "anchors",
              "camera-access",
              "dom-overlay",
            ],
            domOverlay: { root: overlay.current },
          });
          if (disposed) {
            await session.end();
            return;
          }
          await renderer.xr.setSession(session);
          space = await session.requestReferenceSpace("local");
          binding = new XRWebGLBinding(session, renderer.getContext());
          framebuffer = renderer.getContext().createFramebuffer();
          if(callbacks.current?.automatic) {
            handReader=createHandReader(renderer.getContext());
            handWorker=new Worker('/hand-worker.js');
            handWorker.onmessage=({data})=>{
              if(data.type==='ready') handsReady=true;
              if(data.type==='error' || data.type==='inference-error') {handsReady=false;handsBusy=false;}
              if(data.type!=='hands') return;
              handsBusy=false;
              if(performance.now()-data.time>700 || !renderer.xr.isPresenting) return;
              const xrCamera=renderer.xr.getCamera();
              const cards=anchors.filter((a)=>a.object.visible).map((a)=>{
                const pos=a.object.children[0].getWorldPosition(new THREE.Vector3()).project(xrCamera);
                return {id:a.object.uuid,scale:a.targetScale||1,box:[(pos.x+1)/2-0.12,(1-pos.y)/2-0.065,0.24,0.13]};
              });
              const pointer=(data.landmarks || []).map(handPointer).find((p)=>p && cards.some((c)=>p.x>=c.box[0]&&p.x<=c.box[0]+c.box[2]&&p.y>=c.box[1]&&p.y<=c.box[1]+c.box[3]));
              const update=resizeGesture(gestureState,pointer,cards,performance.now());
              gestureState=update.state;
              const anchor=anchors.find((a)=>a.object.uuid===update.id);
              if(anchor) anchor.targetScale=update.scale;
            };
            handWorker.onerror=()=>{handsReady=false;handsBusy=false;};
            handWorker.postMessage({type:'init',base:location.origin});
          }
          setActive(true);
          callbacks.current?.onActive(true);
          nextCapture = performance.now() + 400;
          setStatus("Move slowly to map the shelf. Recognition runs automatically.");
        } catch (e) {
          setStatus(e.message);
          await renderer.xr.getSession()?.end();
        }
      },
      capture() {
        if (!space) {
          setStatus("Start AR first");
          return;
        }
        requested = true;
        setStatus("Capturing shelf…");
      },
      async place(detections, items, capturePose) {
        if (!callbacks.current?.automatic) clear();
        else {
          pending.forEach((p) => p.source.cancel());
          pending = [];
        }
        const current = version,
          pose = capturePose || captured,
          session = renderer.xr.getSession();
        if (!pose || !session || pose.session !== session) {
          setStatus("Start AR and scan again to anchor these candidates.");
          return;
        }
        setStatus("Finding shelf surfaces for candidates…");
        for (const d of detections.slice(0, 12)) {
          try {
            const [x, y, w, h] = d.bbox;
            const { origin, direction } = detectionRay(
              [x, y, x + w, y + h],
              1,
              1,
              pose.projection,
              pose.transform,
            );
            const source = await session.requestHitTestSource({
              space,
              entityTypes: ["plane"],
              offsetRay: new XRRay({ ...origin, w: 1 }, { ...direction, w: 0 }),
            });
            if (
              disposed ||
              current !== version ||
              renderer.xr.getSession() !== session
            ) {
              source.cancel();
              continue;
            }
            const names = [
              ...new Set(
                items
                  .filter((i) => d.matched_item_ids ? d.matched_item_ids.includes(i.id) : i.item === d.prompt)
                  .map((i) => (i.shared ? "Household" : i.requester)),
              ),
            ].join(", ") || (d.matched_item_ids ? "Not on this aisle's list" : "");
            pending.push({
              source,
              d,
              names,
              deadline: performance.now() + 8000,
              current,
            });
          } catch (e) {
            setStatus("Surface placement unavailable: " + e.message);
          }
        }
      },
      remove(prompt) {
        pending
          .filter((p) => p.d.prompt === prompt)
          .forEach((p) => p.source.cancel());
        pending = pending.filter((p) => p.d.prompt !== prompt);
        anchors
          .filter((a) => a.prompt === prompt)
          .forEach((a) => {
            a.anchor.delete();
            scene.remove(a.object);
            disposeObject(a.object);
          });
        anchors = anchors.filter((a) => a.prompt !== prompt);
      },
      async end() {
        await renderer.xr.getSession()?.end();
      },
      clear,
    };
    engine.current = controls;
    renderer.xr.addEventListener("sessionend", ended);
    renderer.setAnimationLoop((_, frame) => {
      if (frame && space) {
        if(handsReady && !handsBusy && performance.now()>nextHands && !callbacks.current?.paused) {
          const view=frame.getViewerPose(space)?.views.find((v)=>v.camera);
          if(view && binding && handReader) {
            try {
              const pixels=handReader.read(binding.getCameraImage(view.camera),view.camera.width,view.camera.height);
              handsBusy=true;nextHands=performance.now()+200;
              const time=performance.now(), worker=handWorker;
              createImageBitmap(pixels).then((image)=>{
                if(disposed || worker!==handWorker) image.close();
                else worker.postMessage({type:'frame',image,time},[image]);
              }).catch(()=>{handsBusy=false;});
            } catch {handsReady=false;}
          }
        }
        if (callbacks.current?.automatic && !callbacks.current.paused && !captureBusy &&
            performance.now() >= nextCapture && !document.hidden) requested = true;
        if (requested && binding) {
          try {
            const pose = frame.getViewerPose(space),
              view = pose?.views.find((v) => v.camera);
            if (view) {
              requested = false;
              const texture = binding.getCameraImage(view.camera);
              const { width, height } = view.camera;
              const pixels = readCameraPixels(
                renderer.getContext(),
                framebuffer,
                texture,
                width,
                height,
              );
              captured = {
                session: renderer.xr.getSession(),
                projection: Array.from(view.projectionMatrix),
                transform: Array.from(view.transform.matrix),
              };
              captureBusy = true;
              const captureSession = captured.session;
              let retryDelay = 800;
              Promise.resolve(callbacks.current?.onCapture(
                cameraPixelsToJpeg(pixels, width, height), captured,
              )).then((result) => {
                if (result?.retryDelay) retryDelay = result.retryDelay;
              }).catch(() => { retryDelay = 5000; }).finally(() => {
                if (renderer.xr.getSession() === captureSession) {
                  captureBusy = false;
                  nextCapture = performance.now() + retryDelay;
                }
              });
              setStatus("Recognising aisle products · existing labels stay anchored");
            }
          } catch (e) {
            requested = false;
            setStatus("Camera capture failed: " + e.message);
          }
        }
        for (const p of [...pending]) {
          let hits = [];
          try {
            hits = frame.getHitTestResults(p.source);
          } catch {
            /* session may be ending */
          }
          if (hits.length) {
            const hitPose = hits[0].getPose(space);
            const position = hitPose && new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(hitPose.transform.matrix));
            const nearby = position && anchors.find((a) =>
              a.prompt === p.d.prompt && a.object.visible &&
              new THREE.Vector3().setFromMatrixPosition(a.object.matrix).distanceTo(position) < 0.12);
            if (callbacks.current?.automatic && nearby) {
              const updated = label(p.d, p.names);
              updated.matrix.copy(nearby.object.matrix);
              updated.scale.copy(nearby.object.scale);
              scene.remove(nearby.object);
              disposeObject(nearby.object);
              nearby.object = updated;
              nearby.prompt = p.d.prompt;
              nearby.seen = performance.now();
              scene.add(updated);
              p.source.cancel();
              pending = pending.filter((v) => v !== p);
              continue;
            }
            const promise = hits[0].createAnchor();
            p.source.cancel();
            pending = pending.filter((v) => v !== p);
            promise
              .then((anchor) => {
                if (disposed || version !== p.current) {
                  anchor.delete();
                  return;
                }
                const object = label(p.d, p.names);
                object.visible = false;
                scene.add(object);
                anchors.push({ anchor, object, prompt: p.d.prompt, seen: performance.now() });
                callbacks.current?.onAnchored?.();
                setStatus(
                  `${anchors.length} shelf labels anchored · double-tap a label`,
                );
              })
              .catch(() => {
                if (!disposed)
                  setStatus(
                    "Surface anchor failed. Use the captured shelf candidates.",
                  );
              });
          } else if (performance.now() > p.deadline) {
            p.source.cancel();
            pending = pending.filter((v) => v !== p);
            setStatus(
              "Some shelf surfaces were not found. Use the captured candidates or scan again.",
            );
          }
        }
        for (const a of anchors) {
          const pose = frame.getPose(a.anchor.anchorSpace, space);
          a.object.visible = !!pose;
          if (pose) a.object.matrix.fromArray(pose.transform.matrix);
          const sprite=a.object.children[0], scale=sprite.scale.x/0.36;
          const nextScale=scale+((a.targetScale||1)-scale)*0.15;
          sprite.scale.set(0.36*nextScale,0.12*nextScale,1);
        }
        if (callbacks.current?.automatic) {
          const expired = anchors.filter((a) => performance.now() - a.seen > 15000);
          expired.forEach((a) => { a.anchor.delete(); scene.remove(a.object); disposeObject(a.object); });
          anchors = anchors.filter((a) => !expired.includes(a));
        }
      }
      renderer.render(scene, camera);
    });
    const raycaster = new THREE.Raycaster();
    let lastTap = 0,
      lastId = null;
    function pick(event) {
      if (
        event.target.closest(
          "button,input,select,textarea,summary,a,.panel,.dock",
        )
      )
        return;
      raycaster.setFromCamera(
        new THREE.Vector2(
          (event.clientX / innerWidth) * 2 - 1,
          1 - (event.clientY / innerHeight) * 2,
        ),
        renderer.xr.isPresenting ? renderer.xr.getCamera() : camera,
      );
      const hit = raycaster.intersectObjects(
        anchors.map((a) => a.object),
        true,
      )[0];
      const detection = hit?.object.userData.detection;
      if (!detection) return;
      if (
        callbacks.current?.automatic || (lastId === detection.detection_id &&
        performance.now() - lastTap < 500
        )
      )
        callbacks.current?.onPick(detection);
      lastId = detection.detection_id;
      lastTap = performance.now();
    }
    const root = overlay.current;
    root.addEventListener("pointerup", pick);
    const resize = () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    };
    addEventListener("resize", resize);
    return () => {
      disposed = true;
      handWorker?.terminate();handReader?.dispose();handReader=null;
      clear();
      renderer.setAnimationLoop(null);
      renderer.xr
        .getSession()
        ?.end()
        .catch(() => {});
      renderer.xr.removeEventListener("sessionend", ended);
      if (framebuffer) renderer.getContext().deleteFramebuffer(framebuffer);
      root.removeEventListener("pointerup", pick);
      removeEventListener("resize", resize);
      renderer.dispose();
      renderer.domElement.remove();
      engine.current = null;
    };
  }, [overlay]);
  return (
    <>
      <div ref={host} className="ar-canvas" />
      <div className="ar-status">
        <span role="status">{status}</span>
        {!active && (
          <button className="primary" onClick={() => engine.current?.start()}>
            START AR
          </button>
        )}
      </div>
    </>
  );
}

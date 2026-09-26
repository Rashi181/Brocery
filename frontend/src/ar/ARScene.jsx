import { useEffect, useRef, useState, useImperativeHandle } from "react";
import * as THREE from "three";
import { detectionRay } from "./detectionRay";
import { cameraPixelsToJpeg, readCameraPixels } from "./cameraFrame";

function label(detection, requester) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(12,22,22,.92)";
  ctx.beginPath();
  ctx.roundRect(0, 0, 768, 256, 28);
  ctx.fill();
  ctx.fillStyle = "#6ee7b7";
  ctx.fillRect(0, 28, 9, 200);
  ctx.font = "bold 48px sans-serif";
  ctx.fillText(detection.prompt.slice(0, 25), 30, 76, 708);
  ctx.fillStyle = "#f3f8f6";
  ctx.font = "32px sans-serif";
  ctx.fillText(requester, 30, 136, 708);
  ctx.fillStyle = "#b6cac2";
  ctx.font = "26px sans-serif";
  ctx.fillText("Candidate · double-tap to inspect", 30, 200, 708);
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
}) {
  const host = useRef(null),
    engine = useRef(null),
    callbacks = useRef(null);
  const [status, setStatus] = useState(
    "Start AR on your phone, or use the label camera.",
  );
  const [active, setActive] = useState(false);
  useEffect(() => {
    callbacks.current = { onCapture, onPick, onActive, onAnchored };
  }, [onCapture, onPick, onActive, onAnchored]);
  useImperativeHandle(
    ref,
    () => ({
      capture: () => engine.current?.capture(),
      place: (detections, items) => engine.current?.place(detections, items),
      end: () => engine.current?.end(),
      clear: () => engine.current?.clear(),
      remove: (prompt) => engine.current?.remove(prompt),
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
      if (framebuffer) renderer.getContext().deleteFramebuffer(framebuffer);
      framebuffer = null;
      if (!disposed) {
        setActive(false);
        callbacks.current?.onActive(false);
        setStatus("AR paused. Start AR to scan and anchor again.");
      }
    }
    const controls = {
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
          setActive(true);
          callbacks.current?.onActive(true);
          setStatus("Move slowly to map the shelf, then scan.");
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
      async place(detections, items) {
        clear();
        const current = version,
          pose = captured,
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
                  .filter((i) => i.item === d.prompt)
                  .map((i) => (i.shared ? "Household" : i.requester)),
              ),
            ].join(", ");
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
              callbacks.current?.onCapture(
                cameraPixelsToJpeg(pixels, width, height),
              );
              setStatus("Shelf captured. Finding your list…");
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
                anchors.push({ anchor, object, prompt: p.d.prompt });
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
        lastId === detection.detection_id &&
        performance.now() - lastTap < 500
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

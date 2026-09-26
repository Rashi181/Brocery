import ScanCamera from './ScanCamera.jsx'
import ProductReview from './ProductReview.jsx'
import ChatImport from './ChatImport'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { ARButton } from 'three/addons/webxr/ARButton.js'
import './App.css'
import { detectionRay } from './detectionRay'

function makeLabelTexture(detectedName, shoppingItem) {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512

  const ctx = canvas.getContext('2d')

  // Card background
  ctx.fillStyle = 'rgba(18, 18, 22, 0.94)'
  ctx.beginPath()
  ctx.roundRect(20, 20, 984, 472, 45)
  ctx.fill()

  // Accent
  ctx.fillStyle = '#7CFFB2'
  ctx.fillRect(20, 20, 18, 472)

  ctx.textAlign = 'left'

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 76px Arial'
  ctx.fillText(detectedName ? detectedName.toUpperCase().slice(0, 22) : 'OAT MILK', 90, 135, 830)

  ctx.fillStyle = '#bbbbc5'
  ctx.font = '48px Arial'
  ctx.fillText(shoppingItem ? 'For ' + (shoppingItem.requester ?? 'Unknown') : detectedName ? 'Detected by SAM' : 'Demo label', 90, 220, 830)

  ctx.fillStyle = '#7CFFB2'
  ctx.font = 'bold 72px Arial'
  ctx.fillText(shoppingItem ? 'CANDIDATE' : detectedName ? 'AR ANCHOR' : 'DEMO', 90, 335)

  ctx.fillStyle = '#ffffff'
  ctx.font = '38px Arial'
  ctx.fillText(shoppingItem ? 'Price / ingredients unverified' : 'Stationary object test', 90, 415)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  return texture
}

function createProductLabel(detectedName, shoppingItem) {
  const group = new THREE.Group()
  group.matrixAutoUpdate = false

  const material = new THREE.SpriteMaterial({
    map: makeLabelTexture(detectedName, shoppingItem),
    transparent: true,
    depthTest: false,
  })

  const sprite = new THREE.Sprite(material)

  // Physical AR size, roughly 45 cm × 22 cm.
  sprite.scale.set(0.45, 0.225, 1)

  // Raise label above the hit point.
  sprite.position.set(0, 0.18, 0)

  group.add(sprite)

  return group
}

function cameraPixelsToJpeg(pixels, width, height) {
  const raw = document.createElement('canvas')
  raw.width = width
  raw.height = height
  const rawContext = raw.getContext('2d')
  if (!rawContext) throw new Error('2D canvas unavailable')
  rawContext.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), width, height), 0, 0)
  const canvas = document.createElement('canvas')
  canvas.width = Math.min(640, width)
  canvas.height = Math.max(1, Math.round(height * canvas.width / width))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas unavailable')
  // Convert WebGL's bottom-left origin to the canvas's top-left origin.
  context.translate(0, canvas.height)
  context.scale(1, -1)
  context.drawImage(raw, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

function readCameraPixels(gl, framebuffer, texture, width, height) {
  const pixels = new Uint8Array(width * height * 4)
  // Three.js uses WebGL2: leave the drawing framebuffer untouched.
  const previousFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)
  const previousPackBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)
  const parameters = [gl.PACK_ALIGNMENT, gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS]
  const previousPack = parameters.map((parameter) => gl.getParameter(parameter))
  try {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    const status = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Camera framebuffer incomplete: ' + status)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    parameters.forEach((parameter, i) => gl.pixelStorei(parameter, i === 0 ? 1 : 0))
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const error = gl.getError()
    if (error !== gl.NO_ERROR) throw new Error('Camera read failed: GL ' + error)
    return pixels
  } finally {
    // Release the browser-owned camera texture before this XR frame ends.
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousFramebuffer)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previousPackBuffer)
    parameters.forEach((parameter, i) => gl.pixelStorei(parameter, previousPack[i]))
  }
}

function App() {
  const xrControl = useRef(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [switchingCamera, setSwitchingCamera] = useState(false)
  const sceneRoot = useRef(null)
  const overlayRoot = useRef(null)
  const uploadController = useRef(null)
  const snapshotRef = useRef(null)
  const capturePose = useRef(null)
  const anchorRequest = useRef(null)
  const [anchorStatus, setAnchorStatus] = useState('')
  const [placingDetection, setPlacingDetection] = useState(false)
  const [arActive, setArActive] = useState(false)
  const [controlsExpanded, setControlsExpanded] = useState(true)
  const [hidePreview, setHidePreview] = useState(false)

  const [status, setStatus] = useState('Press START AR')
  const [canPlace, setCanPlace] = useState(false)
  const [canCapture, setCanCapture] = useState(false)
  const [snapshot, setSnapshot] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [uploadResult, setUploadResult] = useState(null)
  const [segmentResult, setSegmentResult] = useState(null)
  const [shoppingList, setShoppingList] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedItem = shoppingList?.items[selectedIndex] ?? null
  const [prompt, setPrompt] = useState('bottle')

  const updateSnapshot = (image) => {
    if (image) setControlsExpanded(true)
    snapshotRef.current = image
    anchorRequest.current?.cancel()
    setHidePreview(false)
    uploadController.current?.abort()
    setSnapshot(image)
    setSegmentResult(null)
    setUploadStatus('')
    setUploadResult(null)
  }

  useEffect(() => () => uploadController.current?.abort(), [])

  const sendFrame = async (segment = false) => {
    const image = snapshotRef.current
    if (!image || uploadController.current) return
    const controller = new AbortController()
    uploadController.current = controller
    setUploading(true)
    setUploadResult(null)
    setSegmentResult(null)
    setUploadStatus(segment ? 'SAM is segmenting your photo...' : 'Sending frame to laptop...')
    const timeout = setTimeout(() => controller.abort(), segment ? 100000 : 15000)
    try {
      const blob = await (await fetch(image)).blob()
      const response = await fetch(segment ? '/api/segment?prompt=' + encodeURIComponent(prompt.trim()) : '/api/frames', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
        signal: controller.signal,
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) throw new Error(result?.detail || 'Backend unavailable. Start FastAPI and retry.')
      if (!result?.ok || !result.width || !result.height) throw new Error('Unexpected server response. Check the Vite API proxy.')
      if (snapshotRef.current !== image) return
      if (segment) {
        setSegmentResult({ ...result, shoppingItem: selectedItem })
        setUploadStatus(result.objects.length
          ? 'SAM found ' + result.objects.length + ' object(s) in ' + (result.elapsed_ms / 1000).toFixed(1) + 's. Check the colored masks below.'
          : 'SAM completed with no matches. Try a clearer photo or a different object name.')
      } else {
        setUploadResult(result)
        setUploadStatus('Test 9 passed: laptop received the frame ✅')
      }
    } catch (error) {
      if (snapshotRef.current === image) {
        setUploadStatus(error.name === 'AbortError' ? 'Upload timed out. Check FastAPI and retry.' : 'Upload failed: ' + error.message)
      }
    } finally {
      clearTimeout(timeout)
      uploadController.current = null
      setUploading(false)
    }
  }
  const [captureStatus, setCaptureStatus] = useState('Start AR to capture a frame')

  useEffect(() => {
    const container = sceneRoot.current
    const overlay = overlayRoot.current

    // ---------- THREE SCENE ----------

    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      20
    )

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    })

    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.xr.enabled = true

    container.appendChild(renderer.domElement)

    // ---------- RETICLE ----------

    const reticleGeometry = new THREE.RingGeometry(
      0.045,
      0.06,
      32
    )

    reticleGeometry.rotateX(-Math.PI / 2)

    const reticleMaterial = new THREE.MeshBasicMaterial({
      color: 0x7cffb2,
    })

    const reticle = new THREE.Mesh(
      reticleGeometry,
      reticleMaterial
    )

    reticle.matrixAutoUpdate = false
    reticle.visible = false

    scene.add(reticle)

    // ---------- XR STATE ----------

    let referenceSpace = null
    let viewerSpace = null
    let hitTestSource = null

    let currentHitResult = null
    let placeRequested = false

    let glBinding = null
    let cameraConfirmed = false
    let readbackFramebuffer = null
    let captureRequested = false

    const anchoredObjects = []
    let detectionSource = null
    let detectionDeadline = 0
    let detectionName = ''
    let detectionItem = null
    let placementVersion = 0
    let disposed = false
    const clearLabels = () => {
      for (const item of anchoredObjects.splice(0)) {
        item.anchor.delete()
        scene.remove(item.object)
        item.object.traverse((child) => {
          child.material?.map?.dispose()
          child.material?.dispose()
        })
      }
    }
    const cancelDetection = () => {
      placementVersion++
      detectionSource?.cancel()
      detectionSource = null
      setPlacingDetection(false)
      setAnchorStatus('')
    }
    anchorRequest.current = {
      cancel: cancelDetection,
      clear: () => { cancelDetection(); clearLabels() },
      place: async (object, result) => {
        cancelDetection()
        const version = placementVersion
        const session = renderer.xr.getSession()
        const captured = capturePose.current
        if (!session || !captured || captured.session !== session || !referenceSpace) {
          setAnchorStatus('Start AR and capture a new photo first')
          return
        }
        setPlacingDetection(true)
        setAnchorStatus('Finding the surface beneath the detected object...')
        try {
          const { origin, direction } = detectionRay(object.box, result.width, result.height,
            captured.projection, captured.transform)
          const source = await session.requestHitTestSource({
            space: referenceSpace,
            entityTypes: ['plane'],
            offsetRay: new XRRay({ x: origin.x, y: origin.y, z: origin.z, w: 1 },
              { x: direction.x, y: direction.y, z: direction.z, w: 0 }),
          })
          if (disposed || version !== placementVersion || renderer.xr.getSession() !== session) {
            source.cancel()
            return
          }
          detectionName = result.prompt
          detectionItem = result.shoppingItem
          detectionSource = source
          detectionDeadline = performance.now() + 8000
        } catch (error) {
          if (disposed || version !== placementVersion) return
          setPlacingDetection(false)
          setAnchorStatus('Placement failed: ' + error.message)
        }
      },
    }

    // ---------- AR BUTTON ----------

    const arButton = ARButton.createButton(renderer, {
     requiredFeatures: [
      'hit-test',
      'anchors',
      'camera-access',
      'dom-overlay',
    ],

      domOverlay: {
        root: overlay,
      },
    })

    document.body.appendChild(arButton)
    xrControl.current = { end: () => renderer.xr.getSession()?.end(), showButton: (show) => { arButton.style.visibility = show ? '' : 'hidden' } }

    // ---------- SESSION START ----------

    renderer.xr.addEventListener(
      'sessionstart',
      async () => {
        const session = renderer.xr.getSession()
        cameraConfirmed = false
        captureRequested = false
        setArActive(true)
        setControlsExpanded(false)
        setCanCapture(false)
        updateSnapshot(null)
        setCaptureStatus('Waiting for camera access...')
        readbackFramebuffer = renderer.getContext().createFramebuffer()

        glBinding = new XRWebGLBinding(
        session,
        renderer.getContext()
      )

      console.log('XRWebGLBinding created')

        setStatus('Move phone slowly and find a surface')

        referenceSpace =
          await session.requestReferenceSpace('local')

        viewerSpace =
          await session.requestReferenceSpace('viewer')

        hitTestSource =
          await session.requestHitTestSource({
            space: viewerSpace,
          })
      }
    )

    // ---------- SESSION END ----------

    renderer.xr.addEventListener(
      'sessionend',
      () => {
        if (hitTestSource) {
          hitTestSource.cancel()
        }

        cancelDetection()
        capturePose.current = null
        clearLabels()
        hitTestSource = null
        referenceSpace = null
        viewerSpace = null
        glBinding = null
        cameraConfirmed = false
        captureRequested = false
        currentHitResult = null
        placeRequested = false
        reticle.visible = false
        if (readbackFramebuffer) renderer.getContext().deleteFramebuffer(readbackFramebuffer)
        readbackFramebuffer = null
        setArActive(false)
        setControlsExpanded(true)
        setCanCapture(false)
        setCaptureStatus('Start AR to capture another frame')

        setCanPlace(false)
        setStatus('Press START AR')
      }
    )

    // Expose placement request to button.
    window.requestAccessCartPlacement = () => {
      if (!currentHitResult) {
        setStatus('Point at a detected surface first')
        return
      }

      placeRequested = true
    }

    window.requestCameraCapture = () => {
      if (!renderer.xr.isPresenting || !cameraConfirmed || !readbackFramebuffer) {
        setCaptureStatus('Start AR and wait for camera access first')
        return
      }
      captureRequested = true
      setCaptureStatus('Capturing raw camera frame...')
    }

    // ---------- RENDER LOOP ----------

    renderer.setAnimationLoop((time, frame) => {
      if (frame && referenceSpace && glBinding && (!cameraConfirmed || captureRequested)) {
        try {
          const pose = frame.getViewerPose(referenceSpace)
          for (const view of pose?.views ?? []) {
            if (!view.camera) continue
            const texture = glBinding.getCameraImage(view.camera)
            if (!texture) continue
            if (!cameraConfirmed) {
              cameraConfirmed = true
              setCanCapture(Boolean(readbackFramebuffer))
              setStatus('Raw camera access confirmed ✅')
              setCaptureStatus(readbackFramebuffer ? 'Ready to capture' : 'Could not allocate camera framebuffer')
            }
            if (captureRequested) {
              captureRequested = false
              const { width, height } = view.camera
              const pixels = readCameraPixels(renderer.getContext(), readbackFramebuffer, texture, width, height)
              capturePose.current = {
                session: renderer.xr.getSession(),
                projection: Array.from(view.projectionMatrix),
                transform: Array.from(view.transform.matrix),
              }
              updateSnapshot(cameraPixelsToJpeg(pixels, width, height))
              setCaptureStatus('Camera frame captured ✅ ' + width + '×' + height + ' → JPEG (up to 640px wide)')
              console.log('RAW CAMERA FRAME EXTRACTED', { width, height })
            }
            break
          }
        } catch (error) {
          captureRequested = false
          console.error('Camera capture failed:', error)
          setCaptureStatus('Camera capture failed: ' + error.message)
        }
      }
      if (
        frame &&
        referenceSpace &&
        hitTestSource
      ) {
        const results =
          frame.getHitTestResults(hitTestSource)

        if (results.length > 0) {
          const hit = results[0]

          currentHitResult = hit

          const pose =
            hit.getPose(referenceSpace)

          if (pose) {
            reticle.visible = true

            reticle.matrix.fromArray(
              pose.transform.matrix
            )

            setCanPlace(true)
          }

          // IMPORTANT:
          // createAnchor() is called INSIDE the XR frame.
          if (placeRequested) {
            placeRequested = false

            hit
              .createAnchor()
              .then((anchor) => {
                const label =
                  createProductLabel()

                scene.add(label)

                anchoredObjects.push({
                  anchor,
                  object: label,
                })

                setStatus(
                  'Anchored! Walk around and come back.'
                )
              })
              .catch((error) => {
                console.error(
                  'Anchor creation failed:',
                  error
                )

                setStatus(
                  'Anchor creation failed — check console'
                )
              })
          }
        } else {
          currentHitResult = null
          reticle.visible = false

          setCanPlace(false)
        }

        // Keep Three.js objects attached to XR anchors.
        for (const item of anchoredObjects) {
          const pose = frame.getPose(
            item.anchor.anchorSpace,
            referenceSpace
          )

          if (pose) {
            item.object.visible = true

            item.object.matrix.fromArray(
              pose.transform.matrix
            )
          } else {
            item.object.visible = false
          }
        }
      }

      if (frame && referenceSpace && detectionSource) {
        const hits = frame.getHitTestResults(detectionSource)
        if (hits.length) {
          const version = placementVersion
          const session = renderer.xr.getSession()
          const name = detectionName
          const shoppingItem = detectionItem
          // createAnchor must be invoked synchronously inside the active XR frame.
          let pendingAnchor
          try {
            pendingAnchor = hits[0].createAnchor()
          } catch (error) {
            pendingAnchor = Promise.reject(error)
          }
          detectionSource.cancel()
          detectionSource = null
          pendingAnchor.then((anchor) => {
            if (disposed || version !== placementVersion || renderer.xr.getSession() !== session) {
              anchor.delete()
              return
            }
            clearLabels()
            const label = createProductLabel(name, shoppingItem)
            label.visible = false
            scene.add(label)
            anchoredObjects.push({ anchor, object: label })
            setPlacingDetection(false)
            setHidePreview(true)
            setControlsExpanded(false)
            setAnchorStatus('Label anchored at the detected base. Walk sideways to check alignment.')
          }).catch((error) => {
            if (disposed || version !== placementVersion) return
            setPlacingDetection(false)
            setAnchorStatus('Could not create anchor: ' + error.message)
          })
        } else if (performance.now() > detectionDeadline) {
          detectionSource.cancel()
          detectionSource = null
          setPlacingDetection(false)
          setAnchorStatus('No surface found. Scan the tabletop, capture again, and retry.')
        }
      }
      renderer.render(scene, camera)
    })

    // ---------- RESIZE ----------

    const resize = () => {
      camera.aspect =
        window.innerWidth /
        window.innerHeight

      camera.updateProjectionMatrix()

      renderer.setSize(
        window.innerWidth,
        window.innerHeight
      )
    }

    window.addEventListener('resize', resize)

    // ---------- CLEANUP ----------

    return () => {
      disposed = true
      cancelDetection()
      clearLabels()
      hitTestSource?.cancel()
      anchorRequest.current = null
      capturePose.current = null
      reticleGeometry.dispose()
      reticleMaterial.dispose()
      renderer.setAnimationLoop(null)

      window.removeEventListener(
        'resize',
        resize
      )

      delete window.requestAccessCartPlacement
      delete window.requestCameraCapture
      if (readbackFramebuffer) renderer.getContext().deleteFramebuffer(readbackFramebuffer)

      if (arButton.parentNode) {
        arButton.parentNode.removeChild(arButton)
      }

      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(
          renderer.domElement
        )
      }

      xrControl.current = null
      renderer.dispose()
    }
  }, [])

  const selectShoppingItem = (list, index) => {
    anchorRequest.current?.clear()
    setShoppingList(list)
    setSelectedIndex(index)
    setPrompt(list?.items[index]?.product.slice(0, 120) ?? 'bottle')
    setSegmentResult(null)
    setUploadStatus('')
    setHidePreview(false)
  }

  useEffect(() => {
    xrControl.current?.showButton(!scanOpen)
    return () => xrControl.current?.showButton(true)
  }, [scanOpen])

  const openScanner = async () => {
    if (switchingCamera) return
    setSwitchingCamera(true)
    try {
      await xrControl.current?.end()
      setScanOpen(true)
    } catch { setCaptureStatus('Could not exit AR. End the AR session, then open the label scanner.') }
    finally { setSwitchingCamera(false) }
  }

  const captureFrame = () => {
    setControlsExpanded(false)
    window.requestCameraCapture?.()
  }

  const placeLabel = () => {
    window.requestAccessCartPlacement?.()
  }

  return (
    <>
      <div
        ref={sceneRoot}
        className="xr-scene"
      />

      {scanOpen && <ScanCamera item={selectedItem} onClose={() => setScanOpen(false)} />}
      <div
        hidden={scanOpen}
        ref={overlayRoot}
        className="xr-overlay"
      >
        <div className={"top-card" + (arActive && !controlsExpanded ? " compact-card" : "")}>
          <div className="brand">
            ACCESSCART
          </div>

          <button className="capture-button" disabled={switchingCamera || uploading || placingDetection} onClick={openScanner}>{switchingCamera ? "SWITCHING CAMERA…" : "OPEN LABEL SCANNER"}</button>
          {arActive && <div className="camera-toolbar">
            <div className="camera-target">{selectedItem?.product ?? prompt}</div>
            <div className="camera-actions">
              <button className="capture-button" disabled={!canCapture || uploading || placingDetection} onClick={captureFrame}>CAPTURE</button>
              <button className="capture-button" aria-expanded={controlsExpanded} aria-controls="camera-details" onClick={() => setControlsExpanded(value => !value)}>{controlsExpanded ? 'HIDE DETAILS' : 'DETAILS'}</button>
            </div>
            {!controlsExpanded && <div className="camera-hint" role="status">{anchorStatus || (canCapture ? 'Aim at the object, then capture.' : captureStatus)}</div>}
          </div>}
          <div id="camera-details" hidden={arActive && !controlsExpanded}>
          <ChatImport disabled={uploading || placingDetection} onUseList={list => selectShoppingItem(list, 0)} />
          {selectedItem && <section className="chat-item">
            <strong>TEST 13 · SCAN FOR YOUR LIST</strong>
            <label className="segment-label" htmlFor="shopping-item">Requested item</label>
            <select id="shopping-item" className="segment-input" value={selectedIndex} disabled={uploading || placingDetection}
              onChange={e => selectShoppingItem(shoppingList, Number(e.target.value))}>
              {shoppingList.items.map((item, i) => <option key={i} value={i}>{item.product} — {item.requester ?? 'Unknown'}</option>)}
            </select>
            <p>Requested: {selectedItem.quantity ?? 'Unspecified quantity'} {selectedItem.unit ?? ''}</p>
            <p>Restrictions: {selectedItem.restrictions.join('; ') || 'None specified'}</p>
            <p className="capture-status">SAM locates candidates. Product identity, price, ingredients and requested quantity remain unverified.</p>
            {shoppingList.shared_constraints.map((text, i) => <p key={i}>Shared: {text}</p>)}
            <button className="capture-button" disabled={uploading || placingDetection} onClick={() => selectShoppingItem(null, 0)}>EXIT LIST SCAN</button>
          </section>}

          <div className="status">
            {status}
          </div>

          {canPlace && (
            <button
              className="place-button"
              onClick={placeLabel}
            >
              PLACE DEMO LABEL
            </button>
          )}
          <button
            className="capture-button"
            disabled={!canCapture}
            onClick={captureFrame}
          >
            CAPTURE RAW FRAME
          </button>
          <div className="capture-status" role="status">{captureStatus}</div>
          <div className="capture-status" role="status">{anchorStatus}</div>
          {snapshot && hidePreview && <button className="capture-button" onClick={() => setHidePreview(false)}>SHOW PHOTO / DETECTIONS</button>}
          {snapshot && !hidePreview && (
            <div className="snapshot-container">
              <div className="snapshot-title">RAW WEBXR CAMERA FRAME</div>
              <img src={snapshot} className="snapshot" alt="Captured raw WebXR camera frame" />
              <ProductReview key={snapshot + selectedIndex + (selectedItem?.product ?? "")} image={snapshot} item={selectedItem} disabled={uploading || placingDetection} />
              <button className="capture-button" disabled={uploading} onClick={() => sendFrame(false)}>
                {uploading ? 'SENDING...' : 'SEND FRAME TO LAPTOP'}
              </button>
              <label className="segment-label" htmlFor="sam-prompt">Find one object type</label>
              <input id="sam-prompt" className="segment-input" value={prompt}
                maxLength={120} disabled={uploading}
                onChange={(event) => { setPrompt(event.target.value); setSegmentResult(null); setUploadStatus('') }}
                placeholder="bottle, milk carton, cereal box" />
              <button className="capture-button" disabled={uploading || !prompt.trim()}
                onClick={() => sendFrame(true)}>SEGMENT WITH SAM</button>
              <div className="capture-status">Sends this photo to Meta for segmentation.</div>
              <div className="capture-status" role="status">{uploadStatus}</div>
              {segmentResult?.shoppingItem && <div className="chat-item">
                <strong>{segmentResult.objects.length ? 'CANDIDATE FOUND — NEEDS REVIEW' : 'NO CANDIDATE FOUND'}</strong>
                <p>Requested: {segmentResult.shoppingItem.product} for {segmentResult.shoppingItem.requester ?? 'Unknown'}</p>
                <p>Not yet verified: exact product, price, ingredients, and quantity. No cart change.</p>
              </div>}
              {segmentResult && (
                <div className="segmentation-preview">
                  <img src={snapshot} alt="Source photo for segmentation" />
                  <img className="segmentation-overlay" src={segmentResult.overlay} alt="SAM object masks" />
                </div>
              )}
              {segmentResult?.objects.map((object, index) => (
                <button className="capture-button" key={object.id}
                  disabled={!canCapture || uploading || placingDetection}
                  onClick={() => anchorRequest.current?.place(object, segmentResult)}>
                  {placingDetection ? 'PLACING...' : 'PLACE AR LABEL: ' + segmentResult.prompt + ' ' + (index + 1)}
                </button>
              ))}
              {segmentResult?.objects.length > 0 && <div className="capture-status">Keep the object still. Placement estimates its base on a detected surface.</div>}
              {uploadResult && (
                <div className="capture-status">
                  Received: {uploadResult.width}×{uploadResult.height} JPEG · {uploadResult.bytes.toLocaleString()} bytes
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>
    </>
  )
}

export default App
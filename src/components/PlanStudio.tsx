'use client'

import NextImage from 'next/image'
import { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ThreeScene from './ThreeScene'
import { detectWalls } from '@/lib/geometry'
import { objectPresets } from '@/lib/scene-objects'
import type { Crop, Raster, SceneObject, SceneObjectKind, WallSegment } from '@/lib/types'

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

type Tool = 'select' | 'add' | 'crop'
type Drag = { start: [number, number]; current: [number, number] }
type CameraView = 'A' | 'B' | 'C' | 'D'
type SceneCommand = 'top' | 'perspective' | 'view-a' | 'view-b' | 'view-c' | 'view-d' | 'capture' | 'snapshot'
type RenderedView = { id: string; label: CameraView; imageUrl: string; shellUrl: string }

async function canvasFromFile(file: File): Promise<{ raster: Raster; imageUrl: string }> {
  const canvas = document.createElement('canvas')
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = `${BASE_PATH}/pdf.worker.min.mjs`
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
    const page = await pdf.getPage(1)
    let viewport = page.getViewport({ scale: 2.2 })
    const maxSide = 1900
    if (Math.max(viewport.width, viewport.height) > maxSide) viewport = page.getViewport({ scale: 2.2 * maxSide / Math.max(viewport.width, viewport.height) })
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Your browser cannot create a drawing canvas')
    await page.render({ canvas, canvasContext: context, viewport }).promise
  } else {
    const bitmap = await createImageBitmap(file)
    const ratio = Math.min(1, 1900 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.round(bitmap.width * ratio)
    canvas.height = Math.round(bitmap.height * ratio)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Your browser cannot create a drawing canvas')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
  }
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  return { raster: { width: image.width, height: image.height, data: image.data }, imageUrl: canvas.toDataURL('image/png') }
}

const distanceToLine = (point: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const length = dx * dx + dy * dy
  if (!length) return Math.hypot(point[0] - a[0], point[1] - a[1])
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length))
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy)
}

export default function PlanStudio() {
  const [studio, setStudio] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Ready for a layout plan')
  const [projectName, setProjectName] = useState('Untitled plan')
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [raster, setRaster] = useState<Raster | null>(null)
  const [crop, setCrop] = useState<Crop>([0, 0, 1, 1])
  const [segments, setSegments] = useState<WallSegment[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [drag, setDrag] = useState<Drag | null>(null)
  const [planWidth, setPlanWidth] = useState(13)
  const [wallHeight, setWallHeight] = useState(2.7)
  const [wallThickness, setWallThickness] = useState(0.12)
  const [theme, setTheme] = useState<'warm' | 'light' | 'dark'>('warm')
  const [sceneSegments, setSceneSegments] = useState<WallSegment[]>([])
  const [sceneObjects, setSceneObjects] = useState<SceneObject[]>([])
  const [placementKind, setPlacementKind] = useState<SceneObjectKind | null>(null)
  const [activeStep, setActiveStep] = useState(1)
  const [sceneReady, setSceneReady] = useState(false)
  const [command, setCommand] = useState<{ id: number; type: SceneCommand }>({ id: 0, type: 'perspective' })
  const [cameraView, setCameraView] = useState<CameraView>('A')
  const [activeRenderView, setActiveRenderView] = useState<CameraView>('A')
  const [renderPrompt, setRenderPrompt] = useState('Warm contemporary Singapore apartment, natural oak cabinetry, soft neutral upholstery, stone finishes, daylight, elegant realistic styling')
  const [rendering, setRendering] = useState(false)
  const [renderAccessCode, setRenderAccessCode] = useState('')
  const [photorealUrl, setPhotorealUrl] = useState('')
  const [shellUrl, setShellUrl] = useState('')
  const [renderedViews, setRenderedViews] = useState<RenderedView[]>([])
  const [comparison, setComparison] = useState(100)
  const [renderError, setRenderError] = useState('')
  const [toast, setToast] = useState('')
  const [canvasVersion, setCanvasVersion] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2300)
  }, [])

  const activeSegments = useMemo(() => segments.filter((segment) => segment.active), [segments])

  const analyseFile = useCallback(async (file: File) => {
    setBusy(true); setStatus('Analysing drawing in your browser…')
    try {
      const loaded = await canvasFromFile(file)
      const result = detectWalls(loaded.raster)
      const htmlImage = new Image()
      htmlImage.src = loaded.imageUrl
      await htmlImage.decode()
      setRaster(loaded.raster); setImage(htmlImage)
      setCrop(result.crop); setSegments(result.segments); setProjectName(file.name)
      setSceneSegments([]); setSceneObjects([]); setSceneReady(false); setPhotorealUrl(''); setShellUrl(''); setRenderedViews([]); setActiveStep(1); setStudio(true); setTool('select')
      setStatus('Geometry detected · review required')
      notify(`${result.segments.length} likely wall lines detected`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Plan analysis failed'
      notify(message); setStatus('Analysis failed')
    } finally { setBusy(false) }
  }, [notify])

  useEffect(() => {
    const wrapper = wrapRef.current
    if (!wrapper) return
    const observer = new ResizeObserver(() => setCanvasVersion((value) => value + 1))
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [studio])

  const fit = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !raster) return null
    const rect = canvas.getBoundingClientRect()
    const scale = Math.min(rect.width / raster.width, rect.height / raster.height)
    return { scale, ox: (rect.width - raster.width * scale) / 2, oy: (rect.height - raster.height * scale) / 2, width: rect.width, height: rect.height }
  }, [raster])

  const toCanvas = useCallback((x: number, y: number): [number, number] => {
    const current = fit()!
    return [current.ox + x * current.scale, current.oy + y * current.scale]
  }, [fit])
  const toImage = useCallback((x: number, y: number): [number, number] => {
    const current = fit()!
    return [(x - current.ox) / current.scale, (y - current.oy) / current.scale]
  }, [fit])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image || !raster) return
    const rect = canvas.getBoundingClientRect()
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio))
    const context = canvas.getContext('2d')!
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, rect.width, rect.height)
    const current = fit()!
    context.drawImage(image, current.ox, current.oy, raster.width * current.scale, raster.height * current.scale)
    const [cropX, cropY, cropWidth, cropHeight] = crop
    const [canvasX, canvasY] = toCanvas(cropX, cropY)
    context.fillStyle = 'rgba(139,84,40,.05)'; context.fillRect(canvasX, canvasY, cropWidth * current.scale, cropHeight * current.scale)
    context.strokeStyle = 'rgba(139,84,40,.65)'; context.setLineDash([7, 5]); context.strokeRect(canvasX, canvasY, cropWidth * current.scale, cropHeight * current.scale); context.setLineDash([])
    context.lineCap = 'round'
    for (const segment of segments) {
      const [x1, y1, x2, y2] = segment.points
      const a = toCanvas(x1, y1), b = toCanvas(x2, y2)
      context.beginPath(); context.moveTo(...a); context.lineTo(...b)
      context.strokeStyle = !segment.active ? 'rgba(120,113,108,.48)' : segment.manual ? '#1e795e' : '#d54c41'
      context.lineWidth = segment.active ? 3 : 2
      if (!segment.active) context.setLineDash([5, 5])
      context.stroke(); context.setLineDash([])
    }
    const pixelsPerMetre = cropWidth / Math.max(planWidth, 0.1)
    for (const object of sceneObjects) {
      const [objectX, objectY] = toCanvas(object.x, object.y)
      context.save()
      context.translate(objectX, objectY)
      context.rotate(object.rotation)
      const objectWidth = object.width * pixelsPerMetre * current.scale
      const objectDepth = object.depth * pixelsPerMetre * current.scale
      context.fillStyle = object.kind === 'window' ? 'rgba(52,163,200,.45)' : object.kind === 'door' ? 'rgba(139,94,60,.72)' : 'rgba(30,121,94,.55)'
      context.strokeStyle = '#1e795e'; context.lineWidth = 2
      context.fillRect(-objectWidth / 2, -objectDepth / 2, objectWidth, objectDepth)
      context.strokeRect(-objectWidth / 2, -objectDepth / 2, objectWidth, objectDepth)
      context.rotate(-object.rotation)
      context.fillStyle = '#1c1917'; context.font = '600 10px DM Sans'; context.textAlign = 'center'
      context.fillText(objectPresets[object.kind].label, 0, -objectDepth / 2 - 5)
      context.restore()
    }
    if (drag) {
      context.beginPath(); context.moveTo(...drag.start); context.lineTo(...drag.current)
      context.strokeStyle = tool === 'crop' ? '#8b5428' : '#1e795e'; context.lineWidth = 2; context.setLineDash([6, 4]); context.stroke(); context.setLineDash([])
      if (tool === 'crop') context.strokeRect(drag.start[0], drag.start[1], drag.current[0] - drag.start[0], drag.current[1] - drag.start[1])
    }
  }, [image, raster, crop, segments, sceneObjects, planWidth, drag, tool, canvasVersion, fit, toCanvas])

  const pointer = (event: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [event.clientX - rect.left, event.clientY - rect.top]
  }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!image) return
    const point = pointer(event)
    if (placementKind) {
      const [x, y] = toImage(...point)
      const preset = objectPresets[placementKind]
      setSceneObjects((items) => [...items, { id: `o-${Date.now()}`, kind: placementKind, x, y, width: preset.width, depth: preset.depth, height: preset.height, rotation: 0 }])
      setPlacementKind(null); setActiveStep(2); notify(`${preset.label} placed · use the object controls to rotate or remove it`)
      return
    }
    if (tool === 'select') {
      let best: WallSegment | null = null, distance = 10
      for (const segment of segments) {
        const a = toCanvas(segment.points[0], segment.points[1]), b = toCanvas(segment.points[2], segment.points[3])
        const next = distanceToLine(point, a, b)
        if (next < distance) { best = segment; distance = next }
      }
      if (best) setSegments((items) => items.map((item) => item.id === best!.id ? { ...item, active: !item.active } : item))
    } else {
      setDrag({ start: point, current: point }); event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drag || !raster) return
    const end = pointer(event), start = drag.start
    setDrag(null)
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 12) return
    if (tool === 'add') {
      const p1 = toImage(...start), p2 = toImage(...end)
      if (Math.abs(p2[0] - p1[0]) > Math.abs(p2[1] - p1[1])) p2[1] = p1[1]; else p2[0] = p1[0]
      setSegments((items) => [...items, { id: `m-${Date.now()}`, points: [...p1, ...p2].map((value) => +value.toFixed(1)) as [number, number, number, number], confidence: 1, source: 'manual', active: true, manual: true }])
      notify('Manual wall added')
    } else {
      const p1 = toImage(Math.min(start[0], end[0]), Math.min(start[1], end[1]))
      const p2 = toImage(Math.max(start[0], end[0]), Math.max(start[1], end[1]))
      const nextCrop: Crop = [Math.max(0, Math.round(p1[0])), Math.max(0, Math.round(p1[1])), Math.min(raster.width, Math.round(p2[0])) - Math.max(0, Math.round(p1[0])), Math.min(raster.height, Math.round(p2[1])) - Math.max(0, Math.round(p1[1]))]
      try {
        const result = detectWalls(raster, nextCrop)
        setCrop(result.crop); setSegments(result.segments); setTool('select'); setSceneSegments([]); setSceneReady(false)
        setStatus('Geometry re-detected · review required'); notify(`${result.segments.length} lines retained in crop`)
      } catch (error) { notify(error instanceof Error ? error.message : 'Crop analysis failed') }
    }
  }

  const buildScene = () => {
    if (!activeSegments.length) { notify('Keep or add at least one wall'); return }
    setSceneSegments(segments.map((segment) => ({ ...segment }))); setSceneReady(false); setCameraView('A'); setCommand((value) => ({ id: value.id + 1, type: 'view-a' })); setActiveStep(3); setStatus('Building editable 3D model…')
    window.setTimeout(() => { setStatus('Editable 3D model ready'); notify('Walls, openings and furniture rendered in 3D') }, 250)
  }
  const sendCommand = (type: SceneCommand) => setCommand((value) => ({ id: value.id + 1, type }))
  const chooseCameraView = (view: CameraView) => {
    setCameraView(view)
    const existing = renderedViews.find((item) => item.label === view)
    if (existing) { setActiveRenderView(view); setPhotorealUrl(existing.imageUrl); setShellUrl(existing.shellUrl); setComparison(100) }
    sendCommand(`view-${view.toLowerCase()}` as SceneCommand)
    setActiveStep(3)
  }
  const onSceneReady = useCallback((ready: boolean) => setSceneReady(ready), [])
  const onSnapshot = useCallback(async (imageDataUrl: string) => {
    setRendering(true); setRenderError(''); setActiveStep(4); setStatus(`Submitting photorealistic View ${cameraView}…`)
    try {
      const renderHeaders = { 'Content-Type': 'application/json', 'x-render-access-code': renderAccessCode }
      const cameraPrompt = `${renderPrompt}. View ${cameraView}: eye-level interior architectural photography at approximately 1.6 metres, natural wide-angle lens, composed as a finished residential room rather than an overhead model.`
      const response = await fetch('/api/render', { method: 'POST', headers: renderHeaders, body: JSON.stringify({ imageDataUrl, prompt: cameraPrompt }) })
      const submission = await response.json() as { requestId?: string; error?: string }
      if (!response.ok || !submission.requestId) throw new Error(submission.error || 'Rendering failed')
      setStatus('Render queued · waiting for the image model…')
      for (let attempt = 0; attempt < 48; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt < 2 ? 1000 : 2500))
        const poll = await fetch(`/api/render/${encodeURIComponent(submission.requestId)}`, { cache: 'no-store', headers: { 'x-render-access-code': renderAccessCode } })
        const result = await poll.json() as { status?: string; imageUrl?: string; error?: string }
        if (!poll.ok || result.status === 'FAILED') throw new Error(result.error || 'Rendering failed')
        if (result.status === 'COMPLETED' && result.imageUrl) {
          const completed = { id: `${cameraView}-${Date.now()}`, label: cameraView, imageUrl: result.imageUrl, shellUrl: imageDataUrl }
          setPhotorealUrl(result.imageUrl); setShellUrl(imageDataUrl); setActiveRenderView(cameraView); setComparison(100)
          setRenderedViews((items) => [completed, ...items.filter((item) => item.label !== cameraView)])
          setStatus(`Photorealistic View ${cameraView} ready`); notify(`Photorealistic View ${cameraView} completed`)
          return
        }
        setStatus(result.status === 'IN_QUEUE' ? 'Render queued · waiting for capacity…' : 'Creating photorealistic interior…')
      }
      throw new Error('The render is still processing. Please try again shortly.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Rendering failed'
      setRenderError(message); setStatus('Photorealistic rendering needs attention'); notify(message)
    } finally { setRendering(false) }
  }, [cameraView, renderAccessCode, renderPrompt, notify])
  const reset = () => { setStudio(false); setSceneSegments([]); setSceneObjects([]); setSceneReady(false); setPhotorealUrl(''); setShellUrl(''); setRenderedViews([]); setRenderError(''); setActiveStep(1); setStatus('Ready for a layout plan'); setImage(null); setRaster(null); setSegments([]) }

  const toolHint = placementKind ? `Click the plan to place ${objectPresets[placementKind].label}` : tool === 'select' ? 'Click a line to include or exclude it' : tool === 'add' ? 'Drag across the drawing to add a wall' : 'Drag a rectangle around the apartment plan'

  return <>
    <header className="topbar">
      <button className="brand brand-button" onClick={reset}><span className="brand-mark" /><span>Renderline</span></button>
      <div className="status"><span className="status-dot" /><span>{status}</span></div>
      <div className="top-actions"><button className="ghost" onClick={reset}>New project</button><button className="dark" disabled={!sceneReady} onClick={() => sendCommand('capture')}>Export render</button></div>
    </header>
    <main>
      {!studio ? <section className="upload-view">
        <div className="upload-copy"><p className="eyebrow">Next.js plan-to-3D workspace</p><h1>Turn a layout drawing into an editable 3D shell.</h1><p className="lede">Upload a PDF or plan image. Renderline analyses the drawing locally in your browser, lets you correct the geometry, then constructs a scaled interactive scene.</p><div className="truth-note"><strong>Private by design</strong><span>The plan is processed in your browser and is not uploaded to an application server.</span></div></div>
        <div className={`upload-card ${busy ? 'loading' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) analyseFile(file) }}>
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) analyseFile(file) }} />
          <div className="upload-icon">↑</div><h2>Upload layout plan</h2><p>PDF, PNG, JPG or WEBP · processed locally</p>
          <button className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Analysing…' : 'Choose plan'}</button>
          <div className="or"><span />or<span /></div>
          <button className="sample" disabled={busy} onClick={async () => { const response = await fetch(`${BASE_PATH}/sample/Hui-Ting-Layout.pdf`); analyseFile(new File([await response.blob()], 'Hui Ting Layout.pdf', { type: 'application/pdf' })) }}>Use supplied Hui Ting layout</button>
        </div>
      </section> : <section className="studio">
        <aside className="workflow-panel"><p className="eyebrow">Project workflow</p><ol className="steps">{[
          ['Plan geometry', 'Review detected walls'], ['Scale & furnish', 'Add openings and furniture'], ['Editable 3D', 'Orbit and compose'], ['Photoreal render', 'Generate final image'],
        ].map(([label, note], index) => <li key={label} className={activeStep === index + 1 ? 'active' : ''}><button onClick={() => setActiveStep(index + 1)}><span>{index + 1}</span><div><strong>{label}</strong><small>{note}</small></div></button></li>)}</ol><div className="divider" />
          <label>Plan width <span>metres</span><input type="number" min="1" max="100" step="0.1" value={planWidth} onChange={(event) => setPlanWidth(+event.target.value)} /></label>
          <label>Wall height <span>metres</span><input type="number" min="1.8" max="6" step="0.1" value={wallHeight} onChange={(event) => setWallHeight(+event.target.value)} /></label>
          <label>Wall thickness <span>metres</span><input type="number" min="0.05" max="0.6" step="0.01" value={wallThickness} onChange={(event) => setWallThickness(+event.target.value)} /></label>
          <label>Material direction<select value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}><option value="warm">Warm contemporary</option><option value="light">Light minimal</option><option value="dark">Dark modern</option></select></label>
          <div className="object-heading"><strong>Place in model</strong><small>Choose, then click the plan</small></div><div className="object-palette">{(Object.keys(objectPresets) as SceneObjectKind[]).map((kind) => <button key={kind} className={placementKind === kind ? 'active' : ''} onClick={() => { setPlacementKind(kind); setActiveStep(2) }}>{objectPresets[kind].label}</button>)}</div>
          {sceneObjects.length > 0 && <div className="object-list">{sceneObjects.map((object) => <div key={object.id}><span>{objectPresets[object.kind].label}</span><button title="Rotate" onClick={() => setSceneObjects((items) => items.map((item) => item.id === object.id ? { ...item, rotation: item.rotation + Math.PI / 2 } : item))}>↻</button><button title="Remove" onClick={() => setSceneObjects((items) => items.filter((item) => item.id !== object.id))}>×</button></div>)}</div>}
          <div className="metrics"><div><span>{activeSegments.length}</span><small>active walls</small></div><div><span>{sceneObjects.length}</span><small>scene objects</small></div></div>
          {activeStep < 2 ? <button className="primary wide" onClick={() => setActiveStep(2)}>Continue to Step 2 →</button> : <button className="primary wide" onClick={buildScene}>Build editable 3D model →</button>}
        </aside>
        <section className="workspace"><div className="workspace-head"><div><p className="eyebrow">Drawing review</p><h2>{projectName}</h2></div><div className="toolset">{(['select', 'add', 'crop'] as Tool[]).map((item) => <button key={item} className={`tool ${tool === item ? 'active' : ''}`} onClick={() => setTool(item)}>{item === 'select' ? 'Review' : item === 'add' ? 'Add wall' : 'Crop & re-detect'}</button>)}</div></div>
          <div className="canvas-wrap" ref={wrapRef}><canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={(event) => drag && setDrag({ ...drag, current: pointer(event) })} onPointerUp={onPointerUp} /><div className="canvas-hint">{toolHint}</div></div>
          <div className="legend"><span><i className="red" />Detected wall</span><span><i className="green" />Manually added</span><span><i className="grey" />Excluded</span><span className="legend-note">The image remains the source of truth while you correct the overlay.</span></div>
        </section>
        <section className="viewer-panel"><div className="viewer-head"><div><p className="eyebrow">Editable 3D + AI render</p><h2>Camera view</h2></div><span className="chip">{sceneReady ? 'Live geometry' : 'Awaiting geometry'}</span></div><div className="viewer">{sceneSegments.length ? <ThreeScene segments={sceneSegments} objects={sceneObjects} crop={crop} planWidth={planWidth} wallHeight={wallHeight} wallThickness={wallThickness} theme={theme} command={command} onReady={onSceneReady} onSnapshot={onSnapshot} /> : <div className="viewer-empty"><span>◇</span><strong>No model yet</strong><small>Complete Steps 1–2 and build the editable 3D model.</small></div>}</div>
          <div className="viewer-actions"><button className="ghost" disabled={!sceneReady} onClick={() => sendCommand('top')}>Top view</button><button className="ghost" disabled={!sceneReady} onClick={() => sendCommand('perspective')}>Model overview</button><button className="dark" disabled={!sceneReady} onClick={() => sendCommand('capture')}>Download 3D view</button></div>
          <div className="camera-presets"><span>Interior camera</span>{(['A', 'B', 'C', 'D'] as CameraView[]).map((view) => <button key={view} className={cameraView === view ? 'active' : ''} disabled={!sceneReady} onClick={() => chooseCameraView(view)}>View {view}</button>)}</div>
          <div className="render-panel">
            <div className="render-title"><strong>Photorealistic interior views</strong><span>View {cameraView}</span></div>
            <label className="demo-code-label">Demo access code<input type="password" autoComplete="off" value={renderAccessCode} onChange={(event) => setRenderAccessCode(event.target.value)} placeholder="Required on the public demo" /></label>
            <textarea value={renderPrompt} onChange={(event) => setRenderPrompt(event.target.value)} rows={3} placeholder="Describe materials, furniture style and lighting" />
            <button className="primary wide" disabled={!sceneReady || rendering} onClick={() => sendCommand('snapshot')}>{rendering ? `Generating View ${cameraView}…` : `Generate photorealistic View ${cameraView}`}</button>
            {renderError && <p className="render-error">{renderError}</p>}
            {photorealUrl && shellUrl && <div className="photoreal-result">
              <div className="render-comparison">
                <NextImage unoptimized fill src={shellUrl} alt={`Three-dimensional shell for View ${activeRenderView}`} />
                <div className="ai-layer" style={{ clipPath: `inset(0 ${100 - comparison}% 0 0)` }}><NextImage unoptimized fill src={photorealUrl} alt={`AI-generated photorealistic interior View ${activeRenderView}`} /></div>
                <div className="render-badges"><span>Interior · View {activeRenderView}</span><span>Ceiling {Math.round(wallHeight * 1000).toLocaleString()} mm</span></div>
              </div>
              <label className="comparison-control"><span>Shell</span><input type="range" min="0" max="100" value={comparison} onChange={(event) => setComparison(+event.target.value)} /><span>AI render</span></label>
              <a href={photorealUrl} target="_blank" rel="noreferrer">Open full-resolution render ↗</a>
            </div>}
            {renderedViews.length > 0 && <div className="render-gallery">{renderedViews.slice().sort((a, b) => a.label.localeCompare(b.label)).map((view) => <button key={view.id} className={photorealUrl === view.imageUrl ? 'active' : ''} onClick={() => { setCameraView(view.label); setActiveRenderView(view.label); setPhotorealUrl(view.imageUrl); setShellUrl(view.shellUrl); setComparison(100); sendCommand(`view-${view.label.toLowerCase()}` as SceneCommand) }}><NextImage unoptimized width={180} height={108} src={view.imageUrl} alt={`Rendered View ${view.label}`} /><span>{view.label}</span></button>)}</div>}
          </div>
        </section>
      </section>}
    </main>
    <div className={`toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
  </>
}

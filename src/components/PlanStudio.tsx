'use client'

import { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ThreeScene from './ThreeScene'
import { detectWalls } from '@/lib/geometry'
import type { Crop, Raster, WallSegment } from '@/lib/types'

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

type Tool = 'select' | 'add' | 'crop'
type Drag = { start: [number, number]; current: [number, number] }

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
  const [sceneReady, setSceneReady] = useState(false)
  const [command, setCommand] = useState<{ id: number; type: 'top' | 'perspective' | 'capture' }>({ id: 0, type: 'perspective' })
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
  const confidence = activeSegments.length ? Math.round(activeSegments.reduce((sum, segment) => sum + segment.confidence, 0) / activeSegments.length * 100) : 0

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
      setSceneSegments([]); setSceneReady(false); setStudio(true); setTool('select')
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
    if (drag) {
      context.beginPath(); context.moveTo(...drag.start); context.lineTo(...drag.current)
      context.strokeStyle = tool === 'crop' ? '#8b5428' : '#1e795e'; context.lineWidth = 2; context.setLineDash([6, 4]); context.stroke(); context.setLineDash([])
      if (tool === 'crop') context.strokeRect(drag.start[0], drag.start[1], drag.current[0] - drag.start[0], drag.current[1] - drag.start[1])
    }
  }, [image, raster, crop, segments, drag, tool, canvasVersion, fit, toCanvas])

  const pointer = (event: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [event.clientX - rect.left, event.clientY - rect.top]
  }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!image) return
    const point = pointer(event)
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
    setSceneSegments(segments.map((segment) => ({ ...segment }))); setSceneReady(false); setStatus('Building interactive 3D shell…')
    window.setTimeout(() => { setStatus('3D shell ready'); notify('Interactive 3D shell built') }, 250)
  }
  const sendCommand = (type: 'top' | 'perspective' | 'capture') => setCommand((value) => ({ id: value.id + 1, type }))
  const onSceneReady = useCallback((ready: boolean) => setSceneReady(ready), [])
  const reset = () => { setStudio(false); setSceneSegments([]); setSceneReady(false); setStatus('Ready for a layout plan'); setImage(null); setRaster(null); setSegments([]) }

  const toolHint = tool === 'select' ? 'Click a line to include or exclude it' : tool === 'add' ? 'Drag across the drawing to add a wall' : 'Drag a rectangle around the apartment plan'

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
        <aside className="workflow-panel"><p className="eyebrow">Project workflow</p><ol className="steps"><li className="active"><span>1</span><div><strong>Plan geometry</strong><small>Review detected walls</small></div></li><li><span>2</span><div><strong>Scale & height</strong><small>Set real dimensions</small></div></li><li><span>3</span><div><strong>3D scene</strong><small>Orbit and compose</small></div></li><li><span>4</span><div><strong>Render</strong><small>Export current view</small></div></li></ol><div className="divider" />
          <label>Plan width <span>metres</span><input type="number" min="1" max="100" step="0.1" value={planWidth} onChange={(event) => setPlanWidth(+event.target.value)} /></label>
          <label>Wall height <span>metres</span><input type="number" min="1.8" max="6" step="0.1" value={wallHeight} onChange={(event) => setWallHeight(+event.target.value)} /></label>
          <label>Wall thickness <span>metres</span><input type="number" min="0.05" max="0.6" step="0.01" value={wallThickness} onChange={(event) => setWallThickness(+event.target.value)} /></label>
          <label>Material direction<select value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}><option value="warm">Warm contemporary</option><option value="light">Light minimal</option><option value="dark">Dark modern</option></select></label>
          <div className="metrics"><div><span>{activeSegments.length}</span><small>active walls</small></div><div><span>{activeSegments.length ? `${confidence}%` : '—'}</span><small>avg. confidence</small></div></div><button className="primary wide" onClick={buildScene}>Build 3D shell →</button>
        </aside>
        <section className="workspace"><div className="workspace-head"><div><p className="eyebrow">Drawing review</p><h2>{projectName}</h2></div><div className="toolset">{(['select', 'add', 'crop'] as Tool[]).map((item) => <button key={item} className={`tool ${tool === item ? 'active' : ''}`} onClick={() => setTool(item)}>{item === 'select' ? 'Review' : item === 'add' ? 'Add wall' : 'Crop & re-detect'}</button>)}</div></div>
          <div className="canvas-wrap" ref={wrapRef}><canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={(event) => drag && setDrag({ ...drag, current: pointer(event) })} onPointerUp={onPointerUp} /><div className="canvas-hint">{toolHint}</div></div>
          <div className="legend"><span><i className="red" />Detected wall</span><span><i className="green" />Manually added</span><span><i className="grey" />Excluded</span><span className="legend-note">The image remains the source of truth while you correct the overlay.</span></div>
        </section>
        <section className="viewer-panel"><div className="viewer-head"><div><p className="eyebrow">Live 3D shell</p><h2>Camera view</h2></div><span className="chip">{sceneReady ? 'Live geometry' : 'Awaiting geometry'}</span></div><div className="viewer">{sceneSegments.length ? <ThreeScene segments={sceneSegments} crop={crop} planWidth={planWidth} wallHeight={wallHeight} wallThickness={wallThickness} theme={theme} command={command} onReady={onSceneReady} /> : <div className="viewer-empty"><span>◇</span><strong>No scene yet</strong><small>Review the plan and build the 3D shell.</small></div>}</div>
          <div className="viewer-actions"><button className="ghost" disabled={!sceneReady} onClick={() => sendCommand('top')}>Top view</button><button className="ghost" disabled={!sceneReady} onClick={() => sendCommand('perspective')}>Perspective</button><button className="dark" disabled={!sceneReady} onClick={() => sendCommand('capture')}>Capture render</button></div><div className="accuracy"><strong>Current output</strong><p>An editable architectural shell generated from the approved line overlay. Decorative AI furnishing remains a separate provider integration.</p></div>
        </section>
      </section>}
    </main>
    <div className={`toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
  </>
}

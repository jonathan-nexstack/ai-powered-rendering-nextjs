'use client'

import NextImage from 'next/image'
import { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ThreeScene from './ThreeScene'
import { createDimensionChecks, evaluateDimensions, type DimensionCheck } from '@/lib/accuracy'
import { detectWalls } from '@/lib/geometry'
import { objectPresets } from '@/lib/scene-objects'
import type { Crop, Raster, SceneObject, SceneObjectKind, WallSegment } from '@/lib/types'

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
type Tool = 'select' | 'add' | 'crop'
type Drag = { start: [number, number]; current: [number, number] }
type CameraView = 'A' | 'B' | 'C' | 'D'
type SceneCommand = 'top' | 'perspective' | 'view-a' | 'view-b' | 'view-c' | 'view-d' | 'capture' | 'snapshot'
type ShellTheme = 'warm' | 'light' | 'dark'
type RenderedView = { id: string; label: CameraView; imageUrl: string; shellUrl: string; revision: number; variant: string; createdAt: string }
type Material = { id: string; surface: string; selection: string; verified: boolean }

const STEPS = [
  ['Layout', 'Review the source plan'],
  ['Shell', 'Validate and lock geometry'],
  ['Style', 'Set materials and lighting'],
  ['Render', 'Generate and compare'],
  ['Share', 'Prepare client review'],
]

const CAMERA_NAMES: Record<CameraView, string> = {
  A: 'C01 · Living → TV wall',
  B: 'C02 · Settee → dining',
  C: 'C03 · Entrance → living',
  D: 'C04 · Dining → kitchen',
}

const STYLE_PRESETS = [
  { id: 'warm-minimal', name: 'Insight.Out warm minimal', note: 'Walnut, ivory and olive', shell: 'warm' as ShellTheme, wood: '#7b4d2b', wall: '#f3efe6', accent: '#78835a', prompt: 'warm minimal interior, refined walnut joinery, ivory walls, olive accents' },
  { id: 'scandinavian', name: 'Scandinavian light', note: 'Pale oak and soft white', shell: 'light' as ShellTheme, wood: '#c8a679', wall: '#f7f5ef', accent: '#a9b6aa', prompt: 'light Scandinavian interior, pale oak, soft white walls, restrained sage details' },
  { id: 'japandi', name: 'Japandi', note: 'Natural oak and clay', shell: 'warm' as ShellTheme, wood: '#a9784f', wall: '#eee5d8', accent: '#9a6e5d', prompt: 'calm Japandi interior, natural oak, clay accents, low-profile furniture' },
  { id: 'dark-luxe', name: 'Modern dark luxe', note: 'Smoked oak and stone', shell: 'dark' as ShellTheme, wood: '#43352f', wall: '#c8c1b8', accent: '#8d744c', prompt: 'modern dark luxury interior, smoked oak, honed stone, subtle brass details' },
  { id: 'industrial', name: 'Soft industrial', note: 'Concrete and warm timber', shell: 'dark' as ShellTheme, wood: '#815b3e', wall: '#c7c5c0', accent: '#6f7772', prompt: 'soft industrial interior, warm timber, refined concrete, black metal details' },
]

const DEFAULT_MATERIALS: Material[] = [
  { id: 'joinery', surface: 'Feature wall and joinery', selection: 'Walnut veneer · EDL 4218', verified: true },
  { id: 'floor', surface: 'Floor', selection: 'Oak vinyl plank · 180 mm', verified: true },
  { id: 'dining', surface: 'Dining wall', selection: 'Fluted mustard tile · 50 × 200', verified: false },
  { id: 'worktop', surface: 'Kitchen worktop', selection: 'Quartz · Calacatta', verified: true },
  { id: 'walls', surface: 'Walls and ceiling', selection: 'Nippon Odour-less · ivory', verified: true },
]

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
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Your browser cannot create a drawing canvas')
    await page.render({ canvas, canvasContext: context, viewport }).promise
  } else {
    const bitmap = await createImageBitmap(file)
    const ratio = Math.min(1, 1900 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Your browser cannot create a drawing canvas')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close()
  }
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const data = context.getImageData(0, 0, canvas.width, canvas.height)
  return { raster: { width: data.width, height: data.height, data: data.data }, imageUrl: canvas.toDataURL('image/png') }
}

const distanceToLine = (point: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy
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
  const [wallHeight, setWallHeight] = useState(2.65)
  const [wallThickness, setWallThickness] = useState(0.12)
  const [sceneSegments, setSceneSegments] = useState<WallSegment[]>([])
  const [sceneObjects, setSceneObjects] = useState<SceneObject[]>([])
  const [placementKind, setPlacementKind] = useState<SceneObjectKind | null>(null)
  const [activeStep, setActiveStep] = useState(1)
  const [sceneReady, setSceneReady] = useState(false)
  const [command, setCommand] = useState<{ id: number; type: SceneCommand }>({ id: 0, type: 'perspective' })
  const [cameraView, setCameraView] = useState<CameraView>('A')
  const [geometryLocked, setGeometryLocked] = useState(false)
  const [dimensionChecks, setDimensionChecks] = useState<DimensionCheck[]>([])
  const [presetId, setPresetId] = useState('warm-minimal')
  const [woodColour, setWoodColour] = useState('#7b4d2b')
  const [wallColour, setWallColour] = useState('#f3efe6')
  const [accentColour, setAccentColour] = useState('#78835a')
  const [materials, setMaterials] = useState<Material[]>(DEFAULT_MATERIALS)
  const [lighting, setLighting] = useState<'Daylight' | 'Evening' | 'Night'>('Evening')
  const [selectedViews, setSelectedViews] = useState<CameraView[]>(['A', 'B'])
  const [variantCount, setVariantCount] = useState<1 | 2 | 4>(2)
  const [extraDirection, setExtraDirection] = useState('Brass handles, cane dining chairs, sheer curtains and a large olive plant.')
  const [rendering, setRendering] = useState(false)
  const [renderAccessCode, setRenderAccessCode] = useState('')
  const [renderedViews, setRenderedViews] = useState<RenderedView[]>([])
  const [activeRenderId, setActiveRenderId] = useState('')
  const [comparison, setComparison] = useState(100)
  const [renderError, setRenderError] = useState('')
  const [batchRemaining, setBatchRemaining] = useState(0)
  const [toast, setToast] = useState('')
  const [canvasVersion, setCanvasVersion] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const renderQueue = useRef<CameraView[]>([])

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2600)
  }, [])

  const activeSegments = useMemo(() => segments.filter((segment) => segment.active), [segments])
  const accuracy = useMemo(() => evaluateDimensions(dimensionChecks), [dimensionChecks])
  const preset = useMemo(() => STYLE_PRESETS.find((item) => item.id === presetId) ?? STYLE_PRESETS[0], [presetId])
  const activeRender = useMemo(() => {
    const selected = renderedViews.find((item) => item.id === activeRenderId)
    if (selected?.label === cameraView) return selected
    return renderedViews.find((item) => item.label === cameraView)
  }, [activeRenderId, cameraView, renderedViews])
  const unverifiedMaterials = materials.filter((material) => !material.verified)
  const shellTheme = preset.shell

  const renderPrompt = useMemo(() => {
    const schedule = materials.map((material) => `${material.surface}: ${material.selection}${material.verified ? ' (sample verified)' : ' (finish indicative)'}`).join('; ')
    return `${preset.prompt}. Lighting: ${lighting}. Colour direction: wood ${woodColour}, walls ${wallColour}, accent ${accentColour}. Materials: ${schedule}. ${extraDirection}`.trim()
  }, [accentColour, extraDirection, lighting, materials, preset.prompt, wallColour, woodColour])

  const analyseFile = useCallback(async (file: File) => {
    setBusy(true); setStatus('Analysing drawing in your browser…')
    try {
      const loaded = await canvasFromFile(file)
      const result = detectWalls(loaded.raster)
      const htmlImage = new Image(); htmlImage.src = loaded.imageUrl; await htmlImage.decode()
      setRaster(loaded.raster); setImage(htmlImage); setCrop(result.crop); setSegments(result.segments); setProjectName(file.name)
      setSceneSegments([]); setSceneObjects([]); setSceneReady(false); setRenderedViews([]); setActiveRenderId(''); setDimensionChecks([]); setGeometryLocked(false); renderQueue.current = []; setBatchRemaining(0)
      setActiveStep(1); setStudio(true); setTool('select'); setStatus('Geometry detected · review required')
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
  }, [studio, activeStep])

  const fit = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !raster) return null
    const rect = canvas.getBoundingClientRect(), scale = Math.min(rect.width / raster.width, rect.height / raster.height)
    return { scale, ox: (rect.width - raster.width * scale) / 2, oy: (rect.height - raster.height * scale) / 2, width: rect.width, height: rect.height }
  }, [raster])
  const toCanvas = useCallback((x: number, y: number): [number, number] => { const current = fit()!; return [current.ox + x * current.scale, current.oy + y * current.scale] }, [fit])
  const toImage = useCallback((x: number, y: number): [number, number] => { const current = fit()!; return [(x - current.ox) / current.scale, (y - current.oy) / current.scale] }, [fit])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image || !raster || activeStep !== 1) return
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio))
    const context = canvas.getContext('2d')!; context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, rect.width, rect.height)
    const current = fit()!; context.drawImage(image, current.ox, current.oy, raster.width * current.scale, raster.height * current.scale)
    const [cropX, cropY, cropWidth, cropHeight] = crop, [canvasX, canvasY] = toCanvas(cropX, cropY)
    context.fillStyle = 'rgba(139,84,40,.05)'; context.fillRect(canvasX, canvasY, cropWidth * current.scale, cropHeight * current.scale)
    context.strokeStyle = 'rgba(139,84,40,.65)'; context.setLineDash([7, 5]); context.strokeRect(canvasX, canvasY, cropWidth * current.scale, cropHeight * current.scale); context.setLineDash([]); context.lineCap = 'round'
    for (const segment of segments) {
      const [x1, y1, x2, y2] = segment.points, a = toCanvas(x1, y1), b = toCanvas(x2, y2)
      context.beginPath(); context.moveTo(...a); context.lineTo(...b); context.strokeStyle = !segment.active ? 'rgba(120,113,108,.48)' : segment.manual ? '#1e795e' : '#d54c41'; context.lineWidth = segment.active ? 3 : 2
      if (!segment.active) context.setLineDash([5, 5]); context.stroke(); context.setLineDash([])
    }
    const pixelsPerMetre = cropWidth / Math.max(planWidth, 0.1)
    for (const object of sceneObjects) {
      const [objectX, objectY] = toCanvas(object.x, object.y), objectWidth = object.width * pixelsPerMetre * current.scale, objectDepth = object.depth * pixelsPerMetre * current.scale
      context.save(); context.translate(objectX, objectY); context.rotate(object.rotation); context.fillStyle = object.kind === 'window' ? 'rgba(52,163,200,.45)' : object.kind === 'door' ? 'rgba(139,94,60,.72)' : 'rgba(30,121,94,.55)'; context.strokeStyle = '#1e795e'; context.lineWidth = 2
      context.fillRect(-objectWidth / 2, -objectDepth / 2, objectWidth, objectDepth); context.strokeRect(-objectWidth / 2, -objectDepth / 2, objectWidth, objectDepth); context.rotate(-object.rotation); context.fillStyle = '#1c1917'; context.font = '600 10px DM Sans'; context.textAlign = 'center'; context.fillText(objectPresets[object.kind].label, 0, -objectDepth / 2 - 5); context.restore()
    }
    if (drag) {
      context.beginPath(); context.moveTo(...drag.start); context.lineTo(...drag.current); context.strokeStyle = tool === 'crop' ? '#8b5428' : '#1e795e'; context.lineWidth = 2; context.setLineDash([6, 4]); context.stroke(); context.setLineDash([])
      if (tool === 'crop') context.strokeRect(drag.start[0], drag.start[1], drag.current[0] - drag.start[0], drag.current[1] - drag.start[1])
    }
  }, [activeStep, crop, drag, fit, image, planWidth, raster, sceneObjects, segments, toCanvas, tool, canvasVersion])

  const pointer = (event: PointerEvent<HTMLCanvasElement>): [number, number] => { const rect = event.currentTarget.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top] }
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!image) return
    const point = pointer(event)
    if (placementKind) {
      const [x, y] = toImage(...point), item = objectPresets[placementKind]
      setSceneObjects((items) => [...items, { id: `o-${Date.now()}`, kind: placementKind, x, y, width: item.width, depth: item.depth, height: item.height, rotation: 0 }]); setPlacementKind(null); notify(`${item.label} placed`); return
    }
    if (tool === 'select') {
      let best: WallSegment | null = null, distance = 10
      for (const segment of segments) { const next = distanceToLine(point, toCanvas(segment.points[0], segment.points[1]), toCanvas(segment.points[2], segment.points[3])); if (next < distance) { best = segment; distance = next } }
      if (best) { setSegments((items) => items.map((item) => item.id === best!.id ? { ...item, active: !item.active } : item)); setGeometryLocked(false) }
    } else { setDrag({ start: point, current: point }); event.currentTarget.setPointerCapture(event.pointerId) }
  }
  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drag || !raster) return
    const end = pointer(event), start = drag.start; setDrag(null)
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 12) return
    if (tool === 'add') {
      const p1 = toImage(...start), p2 = toImage(...end)
      if (Math.abs(p2[0] - p1[0]) > Math.abs(p2[1] - p1[1])) p2[1] = p1[1]; else p2[0] = p1[0]
      setSegments((items) => [...items, { id: `m-${Date.now()}`, points: [...p1, ...p2].map((value) => +value.toFixed(1)) as [number, number, number, number], confidence: 1, source: 'manual', active: true, manual: true }]); setGeometryLocked(false); notify('Manual wall added')
    } else {
      const p1 = toImage(Math.min(start[0], end[0]), Math.min(start[1], end[1])), p2 = toImage(Math.max(start[0], end[0]), Math.max(start[1], end[1]))
      const nextCrop: Crop = [Math.max(0, Math.round(p1[0])), Math.max(0, Math.round(p1[1])), Math.min(raster.width, Math.round(p2[0])) - Math.max(0, Math.round(p1[0])), Math.min(raster.height, Math.round(p2[1])) - Math.max(0, Math.round(p1[1]))]
      try { const result = detectWalls(raster, nextCrop); setCrop(result.crop); setSegments(result.segments); setTool('select'); setSceneSegments([]); setGeometryLocked(false); setStatus('Geometry re-detected · review required'); notify(`${result.segments.length} lines retained in crop`) } catch (error) { notify(error instanceof Error ? error.message : 'Crop analysis failed') }
    }
  }

  const buildScene = () => {
    if (!activeSegments.length) { notify('Keep or add at least one wall'); return }
    setSceneSegments(segments.map((segment) => ({ ...segment }))); setDimensionChecks(createDimensionChecks(segments, crop, planWidth, wallHeight, wallThickness)); setGeometryLocked(false); setSceneReady(false); setCameraView('A'); setCommand((value) => ({ id: value.id + 1, type: 'perspective' })); setActiveStep(2); setStatus('Editable shell ready · validate dimensions')
  }
  const confirmDisplayedDimensions = () => { setDimensionChecks((items) => items.map((item) => ({ ...item, confirmed: true }))); notify('Displayed measurements marked as reviewed') }
  const lockGeometry = () => {
    if (!accuracy.eligible) { notify('Confirm at least 6 checks with a 90% or better pass rate'); return }
    setGeometryLocked(true); setStatus(`Geometry locked · ${accuracy.passed}/${accuracy.confirmed} confirmed checks passed`); notify(`Geometry locked at ${accuracy.score}% validated accuracy`)
  }
  const sendCommand = (type: SceneCommand) => setCommand((value) => ({ id: value.id + 1, type }))
  const chooseCameraView = (view: CameraView) => {
    setCameraView(view)
    setActiveRenderId(renderedViews.find((item) => item.label === view)?.id ?? '')
    setComparison(100)
    setRenderError('')
    setStatus(`${CAMERA_NAMES[view]} · ${renderedViews.some((item) => item.label === view) ? 'ready for review or a new revision' : 'ready to generate'}`)
    sendCommand(`view-${view.toLowerCase()}` as SceneCommand)
  }
  const startRenderBatch = (views: CameraView[]) => {
    if (!views.length) { notify('Select at least one camera view'); return }
    const [first, ...remaining] = views
    renderQueue.current = remaining
    setBatchRemaining(views.length)
    setCameraView(first)
    setActiveRenderId(renderedViews.find((item) => item.label === first)?.id ?? '')
    setComparison(100)
    setRenderError('')
    setStatus(`${CAMERA_NAMES[first]} · preparing shell snapshot`)
    sendCommand(`view-${first.toLowerCase()}` as SceneCommand)
    window.setTimeout(() => sendCommand('snapshot'), 260)
  }
  const continueRenderBatch = useCallback(() => {
    const next = renderQueue.current.shift()
    if (!next) { setBatchRemaining(0); return false }
    setBatchRemaining(renderQueue.current.length + 1)
    setCameraView(next)
    setActiveRenderId(renderedViews.find((item) => item.label === next)?.id ?? '')
    setComparison(100)
    setRenderError('')
    setStatus(`${CAMERA_NAMES[next]} · preparing shell snapshot`)
    setCommand((value) => ({ id: value.id + 1, type: `view-${next.toLowerCase()}` as SceneCommand }))
    window.setTimeout(() => setCommand((value) => ({ id: value.id + 1, type: 'snapshot' })), 260)
    return true
  }, [renderedViews])
  const goToStep = (step: number) => {
    if (step >= 2 && !sceneSegments.length) {
      setActiveStep(1); notify('Build the validation shell from the Layout step first'); return
    }
    if (step >= 3 && !geometryLocked) {
      setActiveStep(2); notify('Review at least 6 measurements, then lock the geometry first'); return
    }
    if (step === 5 && !renderedViews.length) {
      setActiveStep(4); notify('Complete at least one render before preparing the client review'); return
    }
    setActiveStep(step)
  }
  const onSceneReady = useCallback((ready: boolean) => setSceneReady(ready), [])

  const onSnapshot = useCallback(async (imageDataUrl: string) => {
    if (!geometryLocked) { notify('Lock validated geometry before rendering'); return }
    setRendering(true); setRenderError(''); setActiveStep(4); setStatus(`Submitting ${CAMERA_NAMES[cameraView]}…`)
    try {
      const headers = { 'Content-Type': 'application/json', 'x-render-access-code': renderAccessCode }
      const cameraPrompt = `${renderPrompt}. ${CAMERA_NAMES[cameraView]}. Eye-level architectural photography at 1.6 metres with a natural wide-angle lens. Preserve the locked room geometry, wall positions, openings, camera angle and spatial proportions. Decorative accessories may be conceptual.`
      const response = await fetch('/api/render', { method: 'POST', headers, body: JSON.stringify({ imageDataUrl, prompt: cameraPrompt, numImages: variantCount }) })
      const submission = await response.json() as { requestId?: string; error?: string }
      if (!response.ok || !submission.requestId) throw new Error(submission.error || 'Rendering failed')
      setStatus('Render queued · waiting for the image model…')
      for (let attempt = 0; attempt < 48; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt < 2 ? 1000 : 2500))
        const poll = await fetch(`/api/render/${encodeURIComponent(submission.requestId)}`, { cache: 'no-store', headers: { 'x-render-access-code': renderAccessCode } })
        const result = await poll.json() as { status?: string; imageUrl?: string; imageUrls?: string[]; error?: string }
        if (!poll.ok || result.status === 'FAILED') throw new Error(result.error || 'Rendering failed')
        if (result.status === 'COMPLETED') {
          const urls = result.imageUrls?.length ? result.imageUrls : result.imageUrl ? [result.imageUrl] : []
          if (!urls.length) throw new Error('The provider returned no render')
          const revision = Math.max(0, ...renderedViews.filter((item) => item.label === cameraView).map((item) => item.revision)) + 1
          const completed = urls.map((imageUrl, index): RenderedView => ({ id: `${cameraView}-${revision}-${index}-${Date.now()}`, label: cameraView, imageUrl, shellUrl: imageDataUrl, revision, variant: String.fromCharCode(65 + index), createdAt: new Date().toISOString() }))
          setRenderedViews((items) => [...completed, ...items]); setActiveRenderId(completed[0].id); setComparison(100); setStatus(`${CAMERA_NAMES[cameraView]} · Rev ${revision} ready`); notify(`${CAMERA_NAMES[cameraView]} completed`); continueRenderBatch(); return
        }
        setStatus(result.status === 'IN_QUEUE' ? 'Render queued · waiting for capacity…' : 'Creating photorealistic interior…')
      }
      throw new Error('The render is still processing. Please try again shortly.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Rendering failed'; renderQueue.current = []; setBatchRemaining(0); setRenderError(message); setStatus('Photorealistic rendering needs attention'); notify(message)
    } finally { setRendering(false) }
  }, [cameraView, continueRenderBatch, geometryLocked, notify, renderAccessCode, renderPrompt, renderedViews, variantCount])

  const applyPreset = (id: string) => {
    const next = STYLE_PRESETS.find((item) => item.id === id) ?? STYLE_PRESETS[0]
    setPresetId(next.id); setWoodColour(next.wood); setWallColour(next.wall); setAccentColour(next.accent)
  }
  const reset = () => { renderQueue.current = []; setBatchRemaining(0); setStudio(false); setSceneSegments([]); setSceneObjects([]); setSceneReady(false); setRenderedViews([]); setActiveRenderId(''); setRenderError(''); setDimensionChecks([]); setGeometryLocked(false); setActiveStep(1); setStatus('Ready for a layout plan'); setImage(null); setRaster(null); setSegments([]) }
  const copyReview = async () => {
    const summary = `Renderline client review\n${projectName}\nGeometry: ${accuracy.passed}/${accuracy.confirmed} checks passed (${accuracy.score}%)\nStyle: ${preset.name}\nLighting: ${lighting}\nSelected views: ${selectedViews.map((view) => CAMERA_NAMES[view]).join(', ')}\n${unverifiedMaterials.length ? 'Indicative finishes: ' + unverifiedMaterials.map((item) => item.surface).join(', ') : 'All listed finishes marked verified'}\nAI disclosure: Loose décor and styling elements may be conceptual.`
    await navigator.clipboard.writeText(summary); notify('Client review summary copied')
  }

  const toolHint = placementKind ? `Click the plan to place ${objectPresets[placementKind].label}` : tool === 'select' ? 'Click a line to include or exclude it' : tool === 'add' ? 'Drag across the drawing to add a wall' : 'Drag a rectangle around the apartment plan'
  const checksPanel = <div className="quality-list">
    <div className="quality-item good"><span>✓</span><div><strong>Geometry</strong><small>{geometryLocked ? `${accuracy.passed}/${accuracy.confirmed} confirmed checks passed · ${accuracy.score}%` : 'Review and lock before rendering'}</small></div></div>
    <div className={`quality-item ${unverifiedMaterials.length ? 'warn' : 'good'}`}><span>{unverifiedMaterials.length ? '!' : '✓'}</span><div><strong>Materials</strong><small>{unverifiedMaterials.length ? `${unverifiedMaterials.length} surface marked finish indicative` : 'All listed samples marked verified'}</small></div></div>
    <div className="quality-item good"><span>✓</span><div><strong>View consistency</strong><small>Shared style and material instructions pinned across views</small></div></div>
    <div className="quality-item good"><span>✓</span><div><strong>AI content disclosed</strong><small>Loose décor and styling elements labelled conceptual</small></div></div>
  </div>

  return <>
    <header className="topbar"><button className="brand brand-button" onClick={reset}><span className="brand-mark" /><span>Renderline</span></button><div className="status"><span className="status-dot" /><span>{status}</span></div><div className="top-actions"><button className="ghost" onClick={reset}>New project</button><button className="dark" disabled={!sceneReady} onClick={() => sendCommand('capture')}>Export shell</button></div></header>
    <main>
      {!studio ? <section className="upload-view"><div className="upload-copy"><p className="eyebrow">Geometry-controlled AI visualisation</p><h1>From layout drawing to validated interior concept.</h1><p className="lede">Upload a floor plan, review the detected geometry, validate key dimensions, then generate styled photorealistic views from a locked 3D shell.</p><div className="truth-note"><strong>Accuracy you can audit</strong><span>Renderline reports the pass rate only for measurements explicitly reviewed against the source plan.</span></div></div><div className={`upload-card ${busy ? 'loading' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) analyseFile(file) }}><input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) analyseFile(file) }} /><div className="upload-icon">↑</div><h2>Upload layout plan</h2><p>PDF, PNG, JPG or WEBP · processed locally</p><button className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Analysing…' : 'Choose plan'}</button><div className="or"><span />or<span /></div><button className="sample" disabled={busy} onClick={async () => { const response = await fetch(`${BASE_PATH}/sample/Hui-Ting-Layout.pdf`); analyseFile(new File([await response.blob()], 'Hui Ting Layout.pdf', { type: 'application/pdf' })) }}>Use supplied Hui Ting layout</button></div></section> : <>
        <nav className="project-nav"><div><strong>{projectName.replace(/\.[^.]+$/, '')}</strong><small>{geometryLocked ? `Geometry locked · ${accuracy.score}% of confirmed checks passed` : 'Geometry review in progress'}</small></div><ol>{STEPS.map(([label, note], index) => <li key={label} className={`${activeStep === index + 1 ? 'active' : ''} ${activeStep > index + 1 ? 'done' : ''}`}><button onClick={() => goToStep(index + 1)}><span>{activeStep > index + 1 ? '✓' : index + 1}</span><div><strong>{label}</strong><small>{note}</small></div></button></li>)}</ol></nav>

        {activeStep === 1 && <section className="layout-stage stage"><div className="workspace card"><div className="workspace-head"><div><p className="eyebrow">01 · Layout</p><h2>Review detected geometry</h2></div><div className="toolset">{(['select', 'add', 'crop'] as Tool[]).map((item) => <button key={item} className={`tool ${tool === item ? 'active' : ''}`} onClick={() => setTool(item)}>{item === 'select' ? 'Review' : item === 'add' ? 'Add wall' : 'Crop & re-detect'}</button>)}</div></div><div className="canvas-wrap" ref={wrapRef}><canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={(event) => drag && setDrag({ ...drag, current: pointer(event) })} onPointerUp={onPointerUp} /><div className="canvas-hint">{toolHint}</div></div><div className="legend"><span><i className="red" />Detected</span><span><i className="green" />Manually added</span><span><i className="grey" />Excluded</span><span className="legend-note">The source drawing remains visible during every correction.</span></div></div><aside className="control-card card"><p className="eyebrow">Calibration</p><h2>Set known dimensions</h2><p className="muted">Enter measurements taken from the drawing. These values determine the scale of the 3D model.</p><label>Overall plan width <span>metres</span><input type="number" min="1" max="100" step="0.01" value={planWidth} onChange={(event) => { setPlanWidth(+event.target.value); setGeometryLocked(false) }} /></label><label>Ceiling height <span>metres</span><input type="number" min="1.8" max="6" step="0.01" value={wallHeight} onChange={(event) => { setWallHeight(+event.target.value); setGeometryLocked(false) }} /></label><label>Typical wall thickness <span>metres</span><input type="number" min="0.05" max="0.6" step="0.01" value={wallThickness} onChange={(event) => { setWallThickness(+event.target.value); setGeometryLocked(false) }} /></label><div className="object-heading"><strong>Place in model</strong><small>Choose, then click the plan</small></div><div className="object-palette">{(Object.keys(objectPresets) as SceneObjectKind[]).map((kind) => <button key={kind} className={placementKind === kind ? 'active' : ''} onClick={() => setPlacementKind(kind)}>{objectPresets[kind].label}</button>)}</div>{sceneObjects.length > 0 && <div className="object-list">{sceneObjects.map((object) => <div key={object.id}><span>{objectPresets[object.kind].label}</span><button title="Rotate" onClick={() => setSceneObjects((items) => items.map((item) => item.id === object.id ? { ...item, rotation: item.rotation + Math.PI / 2 } : item))}>↻</button><button title="Remove" onClick={() => setSceneObjects((items) => items.filter((item) => item.id !== object.id))}>×</button></div>)}</div>}<div className="metrics"><div><span>{activeSegments.length}</span><small>active walls</small></div><div><span>{sceneObjects.length}</span><small>scene objects</small></div></div><button className="primary wide" onClick={buildScene}>Build validation shell →</button></aside></section>}

        {activeStep === 2 && <section className="shell-stage stage"><div className="model-card card"><div className="workspace-head"><div><p className="eyebrow">02 · Shell</p><h2>Geometry-locked 3D model</h2></div><span className={`chip ${geometryLocked ? 'success' : ''}`}>{geometryLocked ? 'Geometry locked' : 'Validation required'}</span></div><div className="viewer large">{sceneSegments.length ? <ThreeScene segments={sceneSegments} objects={sceneObjects} crop={crop} planWidth={planWidth} wallHeight={wallHeight} wallThickness={wallThickness} theme={shellTheme} command={command} onReady={onSceneReady} onSnapshot={onSnapshot} /> : <div className="viewer-empty">Build the shell from Layout first.</div>}</div><div className="viewer-actions"><button className={`ghost ${command.type === 'top' ? 'active' : ''}`} disabled={!sceneReady} onClick={() => sendCommand('top')}>Top view</button><button className={`ghost ${command.type === 'perspective' ? 'active' : ''}`} disabled={!sceneReady} onClick={() => sendCommand('perspective')}>Model overview</button>{(['A', 'B', 'C', 'D'] as CameraView[]).map((view) => <button key={view} className={`ghost ${command.type === `view-${view.toLowerCase()}` ? 'active' : ''}`} disabled={!sceneReady} onClick={() => chooseCameraView(view)}>C0{(['A','B','C','D'] as CameraView[]).indexOf(view) + 1}</button>)}</div><div className="accuracy-note"><strong>What the score means</strong><span>The percentage is the share of confirmed source measurements within tolerance. It measures the locked 3D shell—not AI-generated décor.</span></div></div><aside className="validation-card card"><div className="validation-guide"><strong>To continue to Style</strong><ol><li>Compare the source values with the plan or site measurements.</li><li>Confirm at least 6 measurements with a 90% pass rate.</li><li>Lock the geometry, then continue to Style.</li></ol></div><div className="accuracy-score"><div><span>{accuracy.score.toFixed(accuracy.score % 1 ? 1 : 0)}%</span><small>confirmed checks passed</small></div><strong>{accuracy.passed}/{accuracy.confirmed}</strong></div><div className="validation-actions"><button className="ghost" disabled={geometryLocked} onClick={confirmDisplayedDimensions}>Confirm all reviewed values</button>{geometryLocked ? <button className="primary" onClick={() => goToStep(3)}>Continue to Style →</button> : <button className="primary" disabled={!accuracy.eligible} onClick={lockGeometry}>Lock geometry</button>}</div><p className={`validation-status ${geometryLocked || accuracy.eligible ? 'ready' : ''}`}>{geometryLocked ? 'Geometry is locked. Continue to the Style step.' : accuracy.eligible ? 'Review threshold met. You can now lock the geometry.' : `${Math.max(0, 6 - accuracy.confirmed)} more confirmed measurement${Math.max(0, 6 - accuracy.confirmed) === 1 ? '' : 's'} needed before geometry can be locked.`}</p><div className="dimension-table"><div className="dimension-head"><span>Measurement</span><span>Source</span><span>Model</span><span>Check</span></div>{dimensionChecks.map((check) => { const difference = Math.round(check.modelMm - check.sourceMm); const passed = Math.abs(difference) <= check.toleranceMm; return <div className="dimension-row" key={check.id}><label><input type="checkbox" checked={check.confirmed} onChange={(event) => { setDimensionChecks((items) => items.map((item) => item.id === check.id ? { ...item, confirmed: event.target.checked } : item)); setGeometryLocked(false) }} /><span>{check.label}<small>±{check.toleranceMm} mm</small></span></label><input aria-label={`${check.label} source millimetres`} type="number" value={check.sourceMm} onChange={(event) => { setDimensionChecks((items) => items.map((item) => item.id === check.id ? { ...item, sourceMm: +event.target.value } : item)); setGeometryLocked(false) }} /><span>{check.modelMm.toLocaleString()}</span><b className={!check.confirmed ? 'pending' : passed ? 'pass' : 'fail'}>{!check.confirmed ? 'Review' : passed ? 'Pass' : `${difference > 0 ? '+' : ''}${difference}`}</b></div>})}</div><p className="fine-print">Source values start from the calibrated model as a review baseline. Confirm each only after checking it against the supplied drawing or site measurement.</p></aside></section>}

        {activeStep === 3 && <section className="style-stage stage"><div className="style-controls card"><p className="eyebrow">03 · Style</p><h2>Set the look</h2><section><div className="section-title"><strong>Studio presets</strong><small>Applies a coordinated direction</small></div><div className="preset-grid">{STYLE_PRESETS.map((item) => <button key={item.id} className={presetId === item.id ? 'active' : ''} onClick={() => applyPreset(item.id)}><i style={{ background: `linear-gradient(135deg, ${item.wood} 0 50%, ${item.wall} 50%)` }} /><span><strong>{item.name}</strong><small>{item.note}</small></span></button>)}</div></section><section><div className="section-title"><strong>Colour controls</strong><small>Passed into every selected camera</small></div><div className="colour-controls"><label>Wood tone<input type="color" value={woodColour} onChange={(event) => setWoodColour(event.target.value)} /><span>{woodColour}</span></label><label>Wall colour<input type="color" value={wallColour} onChange={(event) => setWallColour(event.target.value)} /><span>{wallColour}</span></label><label>Accent colour<input type="color" value={accentColour} onChange={(event) => setAccentColour(event.target.value)} /><span>{accentColour}</span></label></div></section><section><div className="section-title"><strong>Materials by surface</strong><small>Unverified selections remain indicative</small></div><div className="materials-list">{materials.map((material) => <div key={material.id}><span>{material.surface}</span><input value={material.selection} onChange={(event) => setMaterials((items) => items.map((item) => item.id === material.id ? { ...item, selection: event.target.value } : item))} /><label><input type="checkbox" checked={material.verified} onChange={(event) => setMaterials((items) => items.map((item) => item.id === material.id ? { ...item, verified: event.target.checked } : item))} /> Sample verified</label></div>)}</div></section></div><aside className="style-summary card"><div className="mini-viewer"><ThreeScene segments={sceneSegments} objects={sceneObjects} crop={crop} planWidth={planWidth} wallHeight={wallHeight} wallThickness={wallThickness} theme={shellTheme} command={command} onReady={onSceneReady} onSnapshot={onSnapshot} /></div><p className="eyebrow">Render configuration</p><div className="option-group"><strong>Lighting</strong><div className="segmented">{(['Daylight', 'Evening', 'Night'] as const).map((item) => <button key={item} className={lighting === item ? 'active' : ''} onClick={() => setLighting(item)}>{item}</button>)}</div></div><div className="option-group"><strong>Camera views</strong><div className="check-options">{(['A', 'B', 'C', 'D'] as CameraView[]).map((view) => <label key={view}><input type="checkbox" checked={selectedViews.includes(view)} onChange={(event) => setSelectedViews((items) => event.target.checked ? [...items, view] : items.filter((item) => item !== view))} /><span><b>{CAMERA_NAMES[view]}</b><small>Eye-level · 1.6 m</small></span></label>)}</div></div><div className="option-group"><strong>Variants per view</strong><div className="segmented">{([1, 2, 4] as const).map((count) => <button key={count} className={variantCount === count ? 'active' : ''} onClick={() => setVariantCount(count)}>{count}</button>)}</div></div><label>Extra direction<textarea rows={3} value={extraDirection} onChange={(event) => setExtraDirection(event.target.value)} /></label><div className="render-estimate"><span>{selectedViews.length} views × {variantCount} variants</span><strong>{selectedViews.length * variantCount} renders planned</strong><small>Generate the active camera only, or create every selected camera automatically in sequence.</small></div><button className="primary wide" disabled={!geometryLocked || !selectedViews.length} onClick={() => { const first = selectedViews[0]; chooseCameraView(first); setActiveStep(4) }}>Continue to Render →</button></aside></section>}

        {activeStep === 4 && <section className="render-stage stage"><aside className="view-list card"><p className="eyebrow">04 · Render</p><h2>Camera views</h2>{selectedViews.map((view) => { const revisions = renderedViews.filter((item) => item.label === view); const latest = Math.max(0, ...revisions.map((item) => item.revision)); return <button key={view} disabled={batchRemaining > 0} className={cameraView === view ? 'active' : ''} onClick={() => chooseCameraView(view)}><span>C0{(['A','B','C','D'] as CameraView[]).indexOf(view) + 1}</span><div><strong>{CAMERA_NAMES[view].split(' · ')[1]}</strong><small>{latest ? `Rev ${latest} · ${revisions.filter((item) => item.revision === latest).length} variant${revisions.filter((item) => item.revision === latest).length === 1 ? '' : 's'}` : 'Not rendered'}</small></div></button>})}<div className="access-box"><label>Demo access code<input type="password" autoComplete="off" value={renderAccessCode} onChange={(event) => setRenderAccessCode(event.target.value)} placeholder="Required for live generation" /></label><p className="render-guidance">Choose a camera to review it, generate that camera only, or generate every selected camera in sequence.</p><button className="primary wide" disabled={!sceneReady || rendering || batchRemaining > 0} onClick={() => startRenderBatch([cameraView])}>{rendering || batchRemaining > 0 ? 'Generating…' : `Generate C0${(['A','B','C','D'] as CameraView[]).indexOf(cameraView) + 1} · ${variantCount} variant${variantCount > 1 ? 's' : ''}`}</button>{selectedViews.length > 1 && <button className="ghost wide batch-render" disabled={!sceneReady || rendering || batchRemaining > 0} onClick={() => startRenderBatch(selectedViews)}>{batchRemaining > 0 ? `${batchRemaining} camera${batchRemaining > 1 ? 's' : ''} remaining…` : `Generate all ${selectedViews.length} camera views`}</button>}{renderError && <p className="render-error">{renderError}</p>}</div></aside><div className="review-main card"><div className="workspace-head"><div><p className="eyebrow">{CAMERA_NAMES[activeRender?.label ?? cameraView]}</p><h2>{activeRender ? `Revision ${activeRender.revision} · Variant ${activeRender.variant}` : 'Ready for first render'}</h2></div><span className="chip success">Geometry locked · {accuracy.score}%</span></div>{activeRender ? <><div className="render-comparison"><NextImage unoptimized fill src={activeRender.shellUrl} alt={`Locked shell for ${CAMERA_NAMES[activeRender.label]}`} /><div className="ai-layer" style={{ clipPath: `inset(0 ${100 - comparison}% 0 0)` }}><NextImage unoptimized fill src={activeRender.imageUrl} alt={`AI-generated photorealistic interior ${CAMERA_NAMES[activeRender.label]}`} /></div><div className="dimension-guide ceiling">Ceiling {Math.round(wallHeight * 1000).toLocaleString()} mm</div><div className="render-badges"><span>{CAMERA_NAMES[activeRender.label]}</span><span>Rev {activeRender.revision} · {activeRender.variant}</span></div><div className="ai-disclosure">AI concept · loose décor may not appear in the source drawing</div></div><label className="comparison-control"><span>Shell</span><input type="range" min="0" max="100" value={comparison} onChange={(event) => setComparison(+event.target.value)} /><span>AI render</span></label><a className="full-link" href={activeRender.imageUrl} target="_blank" rel="noreferrer">Open full-resolution render ↗</a></> : <div className="empty-render"><span>◇</span><strong>No generated image yet</strong><small>Select a camera and generate a protected live render. The locked shell remains the geometry source of truth.</small><div className="mini-viewer"><ThreeScene segments={sceneSegments} objects={sceneObjects} crop={crop} planWidth={planWidth} wallHeight={wallHeight} wallThickness={wallThickness} theme={shellTheme} command={command} onReady={onSceneReady} onSnapshot={onSnapshot} /></div></div>}<div className="render-gallery">{renderedViews.map((item) => <button key={item.id} className={activeRender?.id === item.id ? 'active' : ''} onClick={() => { setActiveRenderId(item.id); setCameraView(item.label); setComparison(100) }}><NextImage unoptimized width={190} height={110} src={item.imageUrl} alt={`${CAMERA_NAMES[item.label]} Rev ${item.revision} Variant ${item.variant}`} /><span>C0{(['A','B','C','D'] as CameraView[]).indexOf(item.label) + 1} · R{item.revision}{item.variant}</span></button>)}</div></div><aside className="quality-card card"><p className="eyebrow">Pre-share checks</p><h2>Quality review</h2>{checksPanel}<button className="ghost wide" onClick={() => setActiveStep(3)}>Change style or materials</button><button className="dark wide" disabled={!renderedViews.length} onClick={() => setActiveStep(5)}>Prepare client review →</button></aside></section>}

        {activeStep === 5 && <section className="share-stage stage"><div className="share-preview card"><div className="client-heading"><div><p className="eyebrow">Client review</p><h1>{projectName.replace(/\.[^.]+$/, '')}</h1><p>{preset.name} · {lighting} · Revision set</p></div><div className="approval-chip">Ready for review</div></div>{activeRender ? <div className="client-render"><NextImage unoptimized fill src={activeRender.imageUrl} alt="Selected client render" /><div><span>{CAMERA_NAMES[activeRender.label]}</span><span>Rev {activeRender.revision} · Variant {activeRender.variant}</span></div></div> : <div className="empty-render">Select a completed render before sharing.</div>}<div className="client-disclosure"><strong>Design visualisation</strong><span>The architectural shell is based on reviewed measurements. Loose furniture, decorative accessories, styling and unverified finishes may be AI-generated or indicative and are not construction documentation.</span></div></div><aside className="share-panel card"><p className="eyebrow">05 · Share</p><h2>Review package</h2>{checksPanel}<div className="share-facts"><div><span>Validated geometry</span><strong>{accuracy.score}%</strong></div><div><span>Confirmed measurements</span><strong>{accuracy.confirmed}</strong></div><div><span>Completed renders</span><strong>{renderedViews.length}</strong></div><div><span>Indicative finishes</span><strong>{unverifiedMaterials.length}</strong></div></div><button className="primary wide" onClick={copyReview}>Copy client review summary</button><button className="ghost wide" onClick={() => window.print()}>Print / save as PDF</button><button className="ghost wide" onClick={() => setActiveStep(4)}>Back to render review</button></aside></section>}
      </>}
    </main><div className={`toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
  </>
}

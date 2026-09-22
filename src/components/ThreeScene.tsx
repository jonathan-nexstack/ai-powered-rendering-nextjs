'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Crop, SceneObject, WallSegment } from '@/lib/types'
import { objectPresets } from '@/lib/scene-objects'

type Props = {
  segments: WallSegment[]
  objects: SceneObject[]
  crop: Crop
  planWidth: number
  wallHeight: number
  wallThickness: number
  theme: 'warm' | 'light' | 'dark'
  command: { id: number; type: 'top' | 'perspective' | 'view-a' | 'view-b' | 'view-c' | 'view-d' | 'capture' | 'snapshot' }
  onReady: (ready: boolean) => void
  onSnapshot: (dataUrl: string) => void
}

type SceneState = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  width: number
  depth: number
  height: number
  viewMode: 'top' | 'perspective' | 'camera'
  frame: number
}

function fitWholeModel(current: SceneState, view: 'top' | 'perspective') {
  const { camera, controls, width, depth, height } = current
  camera.fov = 48
  camera.up.set(0, 1, 0)
  const verticalFov = THREE.MathUtils.degToRad(camera.fov)
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.1))

  if (view === 'top') {
    const distance = Math.max(
      (depth / 2) / Math.tan(verticalFov / 2),
      (width / 2) / Math.tan(horizontalFov / 2),
    ) * 1.18
    camera.position.set(0, Math.max(distance, height * 2), 0.01)
    controls.target.set(0, 0, 0)
  } else {
    const limitingFov = Math.min(verticalFov, horizontalFov)
    const radius = Math.hypot(width / 2, depth / 2, height / 2)
    const distance = (radius / Math.sin(limitingFov / 2)) * 1.12
    const target = new THREE.Vector3(0, height * 0.42, 0)
    const direction = new THREE.Vector3(1, 0.72, 1.08).normalize()
    camera.position.copy(target).addScaledVector(direction, distance)
    controls.target.copy(target)
  }

  camera.updateProjectionMatrix()
  controls.update()
}

const palettes = {
  warm: { wall: 0xf0e6da, floor: 0x8d6b4d, background: 0xd7d0c8 },
  light: { wall: 0xf5f3ee, floor: 0xc9b79f, background: 0xe8e7e3 },
  dark: { wall: 0x756d65, floor: 0x403a35, background: 0xaaa39d },
}

export default function ThreeScene({ segments, objects, crop, planWidth, wallHeight, wallThickness, theme, command, onReady, onSnapshot }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<SceneState | null>(null)
  const onReadyRef = useRef(onReady)
  const onSnapshotRef = useRef(onSnapshot)
  useEffect(() => { onReadyRef.current = onReady }, [onReady])
  useEffect(() => { onSnapshotRef.current = onSnapshot }, [onSnapshot])
  useEffect(() => {
    const host = hostRef.current
    const active = segments.filter((segment) => segment.active)
    if (!host || !active.length) { onReadyRef.current(false); return }
    host.replaceChildren()
    const colors = palettes[theme]
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(colors.background)
    scene.fog = new THREE.Fog(colors.background, 25, 65)
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)

    const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI / 2.02
    const [cropX, cropY, cropWidth, cropHeight] = crop
    const scale = planWidth / cropWidth
    const depth = cropHeight * scale
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(planWidth, 0.08, depth),
      new THREE.MeshStandardMaterial({ color: colors.floor, roughness: 0.78 }),
    )
    floor.position.y = -0.06
    floor.receiveShadow = true
    scene.add(floor)
    const wallMaterial = new THREE.MeshStandardMaterial({ color: colors.wall, roughness: 0.72 })
    for (const segment of active) {
      let [x1, y1, x2, y2] = segment.points
      x1 = (x1 - cropX) * scale - planWidth / 2
      x2 = (x2 - cropX) * scale - planWidth / 2
      y1 = (y1 - cropY) * scale - depth / 2
      y2 = (y2 - cropY) * scale - depth / 2
      const length = Math.hypot(x2 - x1, y2 - y1)
      if (length < 0.08) continue
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, wallHeight, wallThickness), wallMaterial)
      mesh.position.set((x1 + x2) / 2, wallHeight / 2, (y1 + y2) / 2)
      mesh.rotation.y = -Math.atan2(y2 - y1, x2 - x1)
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)
    }
    for (const object of objects) {
      const preset = objectPresets[object.kind]
      const x = (object.x - cropX) * scale - planWidth / 2
      const z = (object.y - cropY) * scale - depth / 2
      const material = new THREE.MeshStandardMaterial({
        color: preset.color,
        roughness: object.kind === 'window' ? 0.2 : 0.7,
        transparent: object.kind === 'window',
        opacity: object.kind === 'window' ? 0.55 : 1,
      })
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(object.width, object.height, object.depth), material)
      mesh.position.set(x, object.kind === 'window' ? 1.45 : object.height / 2, z)
      mesh.rotation.y = object.rotation
      mesh.castShadow = object.kind !== 'window'
      mesh.receiveShadow = true
      scene.add(mesh)
    }
    scene.add(new THREE.HemisphereLight(0xfff7eb, 0x5a5149, 2.25))
    const sun = new THREE.DirectionalLight(0xfff1d6, 3.4)
    sun.position.set(-8, 15, -5)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -20; sun.shadow.camera.right = 20
    sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20
    scene.add(sun)
    const current: SceneState = { renderer, scene, camera, controls, width: planWidth, depth, height: wallHeight, viewMode: 'perspective', frame: 0 }
    stateRef.current = current
    const resize = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
      if (current.viewMode !== 'camera') fitWholeModel(current, current.viewMode)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      current.frame = requestAnimationFrame(animate)
    }
    animate()
    onReadyRef.current(true)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(current.frame)
      controls.dispose()
      renderer.dispose()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        }
      })
      if (stateRef.current === current) stateRef.current = null
      host.replaceChildren()
    }
  }, [segments, objects, crop, planWidth, wallHeight, wallThickness, theme])

  useEffect(() => {
    const current = stateRef.current
    if (!current || command.id === 0) return
    if (command.type === 'top') {
      current.viewMode = 'top'
      fitWholeModel(current, 'top')
    } else if (command.type === 'perspective') {
      current.viewMode = 'perspective'
      fitWholeModel(current, 'perspective')
    } else if (command.type.startsWith('view-')) {
      current.viewMode = 'camera'
      const eye = Math.min(1.65, current.height * 0.62)
      const targetY = Math.min(1.35, current.height * 0.5)
      const positions = {
        'view-a': [-current.width * 0.34, eye, current.depth * 0.3],
        'view-b': [current.width * 0.34, eye, current.depth * 0.3],
        'view-c': [-current.width * 0.34, eye, -current.depth * 0.3],
        'view-d': [current.width * 0.34, eye, -current.depth * 0.3],
      } as const
      const targets = {
        'view-a': [current.width * 0.2, targetY, -current.depth * 0.18],
        'view-b': [-current.width * 0.2, targetY, -current.depth * 0.18],
        'view-c': [current.width * 0.2, targetY, current.depth * 0.18],
        'view-d': [-current.width * 0.2, targetY, current.depth * 0.18],
      } as const
      const view = command.type as keyof typeof positions
      current.camera.fov = 62
      current.camera.updateProjectionMatrix()
      current.camera.position.set(...positions[view])
      current.controls.target.set(...targets[view])
      current.controls.update()
    } else if (command.type === 'capture') {
      current.renderer.render(current.scene, current.camera)
      const anchor = document.createElement('a')
      anchor.download = `renderline-${Date.now()}.png`
      anchor.href = current.renderer.domElement.toDataURL('image/png')
      anchor.click()
    } else {
      current.renderer.render(current.scene, current.camera)
      onSnapshotRef.current(current.renderer.domElement.toDataURL('image/jpeg', 0.82))
    }
  }, [command])

  return <div className="three-host" ref={hostRef} aria-label="Interactive 3D wall model" />
}

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
  command: { id: number; type: 'top' | 'perspective' | 'capture' | 'snapshot' }
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
  frame: number
}

const palettes = {
  warm: { wall: 0xf0e6da, floor: 0x8d6b4d, background: 0xd7d0c8 },
  light: { wall: 0xf5f3ee, floor: 0xc9b79f, background: 0xe8e7e3 },
  dark: { wall: 0x756d65, floor: 0x403a35, background: 0xaaa39d },
}

export default function ThreeScene({ segments, objects, crop, planWidth, wallHeight, wallThickness, theme, command, onReady, onSnapshot }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<SceneState | null>(null)

  useEffect(() => {
    const host = hostRef.current
    const active = segments.filter((segment) => segment.active)
    if (!host || !active.length) { onReady(false); return }
    host.replaceChildren()
    const colors = palettes[theme]
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(colors.background)
    scene.fog = new THREE.Fog(colors.background, 25, 65)
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
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
    camera.position.set(planWidth * 0.72, Math.max(8, planWidth * 0.58), depth * 0.85)
    controls.target.set(0, wallHeight * 0.45, 0)
    controls.update()

    const resize = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    const current: SceneState = { renderer, scene, camera, controls, width: planWidth, depth, height: wallHeight, frame: 0 }
    stateRef.current = current
    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      current.frame = requestAnimationFrame(animate)
    }
    animate()
    onReady(true)
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
  }, [segments, objects, crop, planWidth, wallHeight, wallThickness, theme, onReady])

  useEffect(() => {
    const current = stateRef.current
    if (!current || command.id === 0) return
    if (command.type === 'top') {
      current.camera.position.set(0, Math.max(current.width, current.depth) * 1.35, 0.01)
      current.controls.target.set(0, 0, 0)
      current.controls.update()
    } else if (command.type === 'perspective') {
      current.camera.position.set(current.width * 0.72, Math.max(8, current.width * 0.58), current.depth * 0.85)
      current.controls.target.set(0, current.height * 0.45, 0)
      current.controls.update()
    } else if (command.type === 'capture') {
      current.renderer.render(current.scene, current.camera)
      const anchor = document.createElement('a')
      anchor.download = `renderline-${Date.now()}.png`
      anchor.href = current.renderer.domElement.toDataURL('image/png')
      anchor.click()
    } else {
      current.renderer.render(current.scene, current.camera)
      onSnapshot(current.renderer.domElement.toDataURL('image/jpeg', 0.82))
    }
  }, [command, onSnapshot])

  return <div className="three-host" ref={hostRef} aria-label="Interactive 3D wall model" />
}

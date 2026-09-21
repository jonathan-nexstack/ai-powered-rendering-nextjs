export type Point = [number, number]

export type WallSegment = {
  id: string
  points: [number, number, number, number]
  confidence: number
  source: 'paired' | 'long-line' | 'manual'
  active: boolean
  manual?: boolean
}

export type SceneObjectKind = 'door' | 'window' | 'sofa' | 'bed' | 'table' | 'cabinet'

export type SceneObject = {
  id: string
  kind: SceneObjectKind
  x: number
  y: number
  width: number
  depth: number
  height: number
  rotation: number
}

export type Crop = [number, number, number, number]

export type Raster = {
  width: number
  height: number
  data: Uint8ClampedArray
}

export type PlanAnalysis = {
  crop: Crop
  segments: WallSegment[]
  imageSize: [number, number]
}

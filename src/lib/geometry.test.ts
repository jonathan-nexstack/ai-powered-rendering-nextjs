import { describe, expect, it } from 'vitest'
import { detectWalls, suggestCrop } from './geometry'
import type { Raster } from './types'

function blank(width: number, height: number): Raster {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  return { width, height, data }
}

function setDark(raster: Raster, x: number, y: number) {
  const index = (y * raster.width + x) * 4
  raster.data[index] = 0
  raster.data[index + 1] = 0
  raster.data[index + 2] = 0
  raster.data[index + 3] = 255
}

function line(raster: Raster, x1: number, y1: number, x2: number, y2: number) {
  if (y1 === y2) for (let x = x1; x <= x2; x++) setDark(raster, x, y1)
  if (x1 === x2) for (let y = y1; y <= y2; y++) setDark(raster, x1, y)
}

describe('wall detection', () => {
  it('finds paired horizontal and vertical wall boundaries', () => {
    const raster = blank(500, 400)
    line(raster, 80, 70, 420, 70); line(raster, 80, 82, 420, 82)
    line(raster, 80, 70, 80, 340); line(raster, 92, 70, 92, 340)
    const result = detectWalls(raster, [40, 40, 420, 330])
    expect(result.segments.some((segment) => segment.source === 'paired')).toBe(true)
    expect(result.segments.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps crop coordinates inside the raster', () => {
    const raster = blank(300, 200)
    line(raster, 40, 40, 260, 40)
    const [x, y, width, height] = suggestCrop(raster)
    expect(x).toBeGreaterThanOrEqual(0)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(x + width).toBeLessThanOrEqual(raster.width)
    expect(y + height).toBeLessThanOrEqual(raster.height)
  })
})

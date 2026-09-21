import type { Crop, PlanAnalysis, Raster, WallSegment } from './types'

type AxisLine = { o: 'h' | 'v'; c: number; a: number; b: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function isDark(raster: Raster, x: number, y: number) {
  const index = (y * raster.width + x) * 4
  const r = raster.data[index]
  const g = raster.data[index + 1]
  const b = raster.data[index + 2]
  return r * 0.299 + g * 0.587 + b * 0.114 < 175
}

export function suggestCrop(raster: Raster): Crop {
  const { width, height } = raster
  let minX = width, minY = height, maxX = 0, maxY = 0
  const columnInk = new Uint32Array(width)
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (!isDark(raster, x, y)) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      columnInk[x]++
    }
  }
  if (minX >= maxX || minY >= maxY) return [0, 0, width, height]

  // Architectural sheets often place a title block to the right of a wide blank gutter.
  const start = Math.round(width * 0.5)
  const end = Math.round(width * 0.88)
  const lowThreshold = Math.max(1, height * 0.002)
  let best: [number, number] | null = null
  let runStart = -1
  for (let x = start; x <= end; x += 2) {
    let density = 0
    for (let sx = Math.max(0, x - 4); sx <= Math.min(width - 1, x + 4); sx += 2) density += columnInk[sx]
    const low = density < lowThreshold * 5
    if (low && runStart < 0) runStart = x
    if ((!low || x === end) && runStart >= 0) {
      const runEnd = low ? x : x - 2
      if (runEnd - runStart > width * 0.045 && (!best || runEnd - runStart > best[1] - best[0])) best = [runStart, runEnd]
      runStart = -1
    }
  }
  if (best) {
    let rightInk = 0
    for (let x = best[1]; x < maxX; x += 4) rightInk += columnInk[x]
    if (rightInk > height * 0.1) maxX = best[0]
  }
  const pad = Math.round(Math.min(width, height) * 0.025)
  const x = clamp(minX - pad, 0, width - 1)
  const y = clamp(minY - pad, 0, height - 1)
  return [x, y, clamp(maxX - minX + pad * 2, 80, width - x), clamp(maxY - minY + pad * 2, 80, height - y)]
}

function scanRuns(raster: Raster, crop: Crop): AxisLine[] {
  const [x0, y0, cw, ch] = crop
  const minLen = Math.max(38, Math.round(Math.min(cw, ch) * 0.065))
  const lines: AxisLine[] = []
  const gap = 3

  for (let y = y0; y < y0 + ch; y += 2) {
    let start = -1, lastDark = -1
    for (let x = x0; x <= x0 + cw; x++) {
      const dark = x < x0 + cw && isDark(raster, x, y)
      if (dark) {
        if (start < 0) start = x
        lastDark = x
      }
      if (start >= 0 && (!dark && x - lastDark > gap || x === x0 + cw)) {
        if (lastDark - start >= minLen) lines.push({ o: 'h', c: y, a: start, b: lastDark })
        start = -1
        lastDark = -1
      }
    }
  }
  for (let x = x0; x < x0 + cw; x += 2) {
    let start = -1, lastDark = -1
    for (let y = y0; y <= y0 + ch; y++) {
      const dark = y < y0 + ch && isDark(raster, x, y)
      if (dark) {
        if (start < 0) start = y
        lastDark = y
      }
      if (start >= 0 && (!dark && y - lastDark > gap || y === y0 + ch)) {
        if (lastDark - start >= minLen) lines.push({ o: 'v', c: x, a: start, b: lastDark })
        start = -1
        lastDark = -1
      }
    }
  }
  return lines
}

function mergeLines(lines: AxisLine[], coordTolerance = 6, gap = 14) {
  const merged: AxisLine[] = []
  for (const orientation of ['h', 'v'] as const) {
    const group = lines.filter((line) => line.o === orientation).sort((a, b) => a.c - b.c || a.a - b.a)
    for (const line of group) {
      const match = [...merged].reverse().find((item) => item.o === orientation && Math.abs(item.c - line.c) <= coordTolerance && line.a <= item.b + gap && line.b >= item.a - gap)
      if (!match) {
        merged.push({ ...line })
        continue
      }
      const oldLength = match.b - match.a
      const newLength = line.b - line.a
      match.a = Math.min(match.a, line.a)
      match.b = Math.max(match.b, line.b)
      match.c = (match.c * oldLength + line.c * newLength) / Math.max(1, oldLength + newLength)
    }
  }
  return merged
}

export function detectWalls(raster: Raster, requestedCrop?: Crop): PlanAnalysis {
  const crop = requestedCrop ?? suggestCrop(raster)
  const [x0, y0, cw, ch] = crop.map(Math.round) as Crop
  if (cw < 80 || ch < 80) throw new Error('Crop area is too small')
  const lines = mergeLines(scanRuns(raster, [x0, y0, cw, ch]))
  const used = new Set<number>()
  const segments: WallSegment[] = []
  const minLen = Math.max(38, Math.round(Math.min(cw, ch) * 0.065))

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue
    const first = lines[i]
    let bestIndex = -1
    let bestScore = 0
    for (let j = i + 1; j < lines.length; j++) {
      if (used.has(j) || lines[j].o !== first.o) continue
      const second = lines[j]
      const distance = Math.abs(first.c - second.c)
      const overlap = Math.max(0, Math.min(first.b, second.b) - Math.max(first.a, second.a))
      const shorter = Math.max(1, Math.min(first.b - first.a, second.b - second.a))
      const ratio = overlap / shorter
      if (distance >= 3 && distance <= 24 && ratio >= 0.58) {
        const score = ratio * overlap / (1 + distance * 0.02)
        if (score > bestScore) { bestIndex = j; bestScore = score }
      }
    }
    if (bestIndex < 0) continue
    const second = lines[bestIndex]
    used.add(i); used.add(bestIndex)
    const start = Math.max(first.a, second.a)
    const end = Math.min(first.b, second.b)
    if (end - start < minLen * 0.75) continue
    const coordinate = (first.c + second.c) / 2
    const points: [number, number, number, number] = first.o === 'h'
      ? [start, coordinate, end, coordinate]
      : [coordinate, start, coordinate, end]
    segments.push({ id: `p-${i}`, points, confidence: Math.min(0.98, 0.62 + bestScore / 600), source: 'paired', active: true })
  }

  const longCut = Math.max(cw, ch) * 0.22
  lines.forEach((line, index) => {
    if (used.has(index) || line.b - line.a < longCut) return
    const points: [number, number, number, number] = line.o === 'h'
      ? [line.a, line.c, line.b, line.c]
      : [line.c, line.a, line.c, line.b]
    segments.push({ id: `l-${index}`, points, confidence: 0.52, source: 'long-line', active: true })
  })

  segments.sort((a, b) => b.confidence - a.confidence || Math.hypot(b.points[2] - b.points[0], b.points[3] - b.points[1]) - Math.hypot(a.points[2] - a.points[0], a.points[3] - a.points[1]))
  return { crop: [x0, y0, cw, ch], segments: segments.slice(0, 100), imageSize: [raster.width, raster.height] }
}

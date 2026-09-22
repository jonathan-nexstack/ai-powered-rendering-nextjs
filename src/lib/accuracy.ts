import type { Crop, WallSegment } from './types'

export type DimensionCheck = {
  id: string
  label: string
  category: 'overall' | 'height' | 'wall'
  sourceMm: number
  modelMm: number
  toleranceMm: number
  confirmed: boolean
}

export type DimensionResult = DimensionCheck & {
  differenceMm: number
  passed: boolean
}

export function evaluateDimensions(checks: DimensionCheck[]) {
  const confirmed = checks.filter((check) => check.confirmed && check.sourceMm > 0 && check.modelMm > 0)
  const results: DimensionResult[] = confirmed.map((check) => {
    const differenceMm = Math.round(check.modelMm - check.sourceMm)
    return { ...check, differenceMm, passed: Math.abs(differenceMm) <= check.toleranceMm }
  })
  const passed = results.filter((result) => result.passed).length
  const score = results.length ? Math.round((passed / results.length) * 1000) / 10 : 0
  return { results, confirmed: results.length, passed, score, eligible: results.length >= 6 && score >= 90 }
}

export function createDimensionChecks(
  segments: WallSegment[],
  crop: Crop,
  planWidthMetres: number,
  wallHeightMetres: number,
  wallThicknessMetres: number,
): DimensionCheck[] {
  const [, , cropWidth, cropHeight] = crop
  const safeWidth = Math.max(cropWidth, 1)
  const millimetresPerPixel = (Math.max(planWidthMetres, 0.1) * 1000) / safeWidth
  const depthMm = Math.round(cropHeight * millimetresPerPixel)
  const core: DimensionCheck[] = [
    { id: 'overall-width', label: 'Overall plan width', category: 'overall', sourceMm: Math.round(planWidthMetres * 1000), modelMm: Math.round(planWidthMetres * 1000), toleranceMm: 50, confirmed: false },
    { id: 'overall-depth', label: 'Overall plan depth', category: 'overall', sourceMm: depthMm, modelMm: depthMm, toleranceMm: 50, confirmed: false },
    { id: 'ceiling-height', label: 'Ceiling height', category: 'height', sourceMm: Math.round(wallHeightMetres * 1000), modelMm: Math.round(wallHeightMetres * 1000), toleranceMm: 25, confirmed: false },
    { id: 'wall-thickness', label: 'Typical wall thickness', category: 'wall', sourceMm: Math.round(wallThicknessMetres * 1000), modelMm: Math.round(wallThicknessMetres * 1000), toleranceMm: 25, confirmed: false },
  ]

  const walls = segments
    .filter((segment) => segment.active)
    .map((segment) => ({ segment, length: Math.hypot(segment.points[2] - segment.points[0], segment.points[3] - segment.points[1]) }))
    .filter(({ length }) => length * millimetresPerPixel >= 500)
    .sort((a, b) => b.length - a.length)
    .slice(0, 8)
    .map(({ segment, length }, index): DimensionCheck => {
      const modelMm = Math.round(length * millimetresPerPixel)
      return {
        id: `wall-${segment.id}`,
        label: `Key wall ${index + 1}`,
        category: 'wall',
        sourceMm: modelMm,
        modelMm,
        toleranceMm: 50,
        confirmed: false,
      }
    })

  return [...core, ...walls]
}

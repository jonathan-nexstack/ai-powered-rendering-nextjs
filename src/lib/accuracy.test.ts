import { describe, expect, it } from 'vitest'
import { createDimensionChecks, evaluateDimensions } from './accuracy'
import type { WallSegment } from './types'

const walls: WallSegment[] = Array.from({ length: 8 }, (_, index) => ({
  id: String(index),
  points: [0, index * 10, 100 - index * 3, index * 10],
  confidence: 1,
  source: 'manual',
  active: true,
}))

describe('dimension validation', () => {
  it('creates auditable checks from calibrated geometry', () => {
    const checks = createDimensionChecks(walls, [0, 0, 100, 80], 10, 2.65, 0.12)
    expect(checks).toHaveLength(12)
    expect(checks[0]).toMatchObject({ label: 'Overall plan width', modelMm: 10000, confirmed: false })
    expect(checks[1]).toMatchObject({ label: 'Overall plan depth', modelMm: 8000 })
  })

  it('requires six confirmed checks and a ninety-percent pass rate', () => {
    const checks = createDimensionChecks(walls, [0, 0, 100, 80], 10, 2.65, 0.12)
      .map((check) => ({ ...check, confirmed: true }))
    expect(evaluateDimensions(checks)).toMatchObject({ confirmed: 12, passed: 12, score: 100, eligible: true })

    checks[0] = { ...checks[0], sourceMm: checks[0].modelMm + 500 }
    checks[1] = { ...checks[1], sourceMm: checks[1].modelMm + 500 }
    const result = evaluateDimensions(checks)
    expect(result.score).toBeLessThan(90)
    expect(result.eligible).toBe(false)
  })
})

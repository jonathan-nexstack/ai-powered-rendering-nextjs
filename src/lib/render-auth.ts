import { timingSafeEqual } from 'node:crypto'

export function hasRenderAccess(request: Request) {
  const expected = process.env.RENDER_ACCESS_CODE
  if (!expected) return true

  const supplied = request.headers.get('x-render-access-code') ?? ''
  const expectedBuffer = Buffer.from(expected)
  const suppliedBuffer = Buffer.from(supplied)
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer)
}

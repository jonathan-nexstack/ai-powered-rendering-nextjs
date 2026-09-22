import { afterEach, describe, expect, it } from 'vitest'
import { POST } from './route'
import { GET } from './[requestId]/route'

const originalKey = process.env.FAL_KEY
const originalAccessCode = process.env.RENDER_ACCESS_CODE

afterEach(() => {
  if (originalKey) process.env.FAL_KEY = originalKey
  else delete process.env.FAL_KEY
  if (originalAccessCode) process.env.RENDER_ACCESS_CODE = originalAccessCode
  else delete process.env.RENDER_ACCESS_CODE
})

describe('photorealistic render API', () => {
  it('reports missing provider configuration clearly', async () => {
    delete process.env.FAL_KEY
    const response = await POST(new Request('http://localhost/api/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: 'data:image/jpeg;base64,abc=', prompt: 'warm interior' }),
    }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('FAL_KEY') })
  })

  it('rejects an invalid demo access code before provider work', async () => {
    process.env.FAL_KEY = 'test-key'
    process.env.RENDER_ACCESS_CODE = 'presentation-code'
    const response = await POST(new Request('http://localhost/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-render-access-code': 'wrong-code' },
      body: JSON.stringify({ imageDataUrl: 'data:image/jpeg;base64,abc=', prompt: 'warm interior' }),
    }))
    expect(response.status).toBe(401)
  })

  it('rejects missing camera snapshots before calling the provider', async () => {
    process.env.FAL_KEY = 'test-key'
    delete process.env.RENDER_ACCESS_CODE
    const response = await POST(new Request('http://localhost/api/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'warm interior' }),
    }))
    expect(response.status).toBe(400)
  })

  it('rejects unsupported batch sizes before calling the provider', async () => {
    process.env.FAL_KEY = 'test-key'
    delete process.env.RENDER_ACCESS_CODE
    const response = await POST(new Request('http://localhost/api/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: 'data:image/jpeg;base64,abc=', prompt: 'warm interior', numImages: 3 }),
    }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('1, 2 or 4') })
  })

  it('rejects invalid queue request IDs before polling the provider', async () => {
    process.env.FAL_KEY = 'test-key'
    delete process.env.RENDER_ACCESS_CODE
    const response = await GET(new Request('http://localhost/api/render/bad'), { params: Promise.resolve({ requestId: 'bad' }) })
    expect(response.status).toBe(400)
  })
})

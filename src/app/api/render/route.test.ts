import { afterEach, describe, expect, it } from 'vitest'
import { POST } from './route'
import { GET } from './[requestId]/route'

const originalKey = process.env.FAL_KEY

afterEach(() => {
  if (originalKey) process.env.FAL_KEY = originalKey
  else delete process.env.FAL_KEY
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

  it('rejects missing camera snapshots before calling the provider', async () => {
    process.env.FAL_KEY = 'test-key'
    const response = await POST(new Request('http://localhost/api/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'warm interior' }),
    }))
    expect(response.status).toBe(400)
  })

  it('rejects invalid queue request IDs before polling the provider', async () => {
    process.env.FAL_KEY = 'test-key'
    const response = await GET(new Request('http://localhost/api/render/bad'), { params: Promise.resolve({ requestId: 'bad' }) })
    expect(response.status).toBe(400)
  })
})

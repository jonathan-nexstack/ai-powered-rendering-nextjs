import { afterEach, describe, expect, it } from 'vitest'
import { POST } from './route'

const originalKey = process.env.FAL_KEY

afterEach(() => {
  if (originalKey) process.env.FAL_KEY = originalKey
  else delete process.env.FAL_KEY
})

describe('photorealistic render API', () => {
  it('reports missing provider configuration clearly', async () => {
    delete process.env.FAL_KEY
    const response = await POST(new Request('http://localhost/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: 'data:image/jpeg;base64,abc', prompt: 'warm interior' }),
    }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('FAL_KEY') })
  })

  it('rejects missing camera snapshots before calling the provider', async () => {
    process.env.FAL_KEY = 'test-key'
    const response = await POST(new Request('http://localhost/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'warm interior' }),
    }))
    expect(response.status).toBe(400)
  })
})

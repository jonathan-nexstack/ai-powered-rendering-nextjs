import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MODEL = 'fal-ai/flux-2/klein/9b/edit'
const QUEUE_URL = `https://queue.fal.run/${MODEL}`
const DATA_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/

export async function POST(request: Request) {
  const key = process.env.FAL_KEY
  if (!key) return NextResponse.json({ error: 'Photorealistic rendering is not configured yet. Add FAL_KEY in Vercel.' }, { status: 503 })

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength && contentLength > 4_000_000) return NextResponse.json({ error: 'The camera snapshot is too large.' }, { status: 413 })

  const body = await request.json().catch(() => null) as { imageDataUrl?: unknown; prompt?: unknown } | null
  if (!body || typeof body.imageDataUrl !== 'string') return NextResponse.json({ error: 'A valid 3D camera snapshot is required.' }, { status: 400 })
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 1800) return NextResponse.json({ error: 'Enter a rendering prompt of up to 1,800 characters.' }, { status: 400 })

  const match = DATA_URL_RE.exec(body.imageDataUrl)
  if (!match) return NextResponse.json({ error: 'Only JPEG, PNG or WebP camera snapshots are accepted.' }, { status: 400 })
  const padding = match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0
  const decodedBytes = Math.floor(match[1].length * 3 / 4) - padding
  if (decodedBytes > 3_000_000) return NextResponse.json({ error: 'The decoded camera snapshot exceeds 3 MB.' }, { status: 413 })

  try {
    const upstream = await fetch(QUEUE_URL, {
      method: 'POST',
      headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `${body.prompt.trim()}. Preserve the exact room geometry, wall positions, openings, camera angle and spatial proportions from the supplied 3D reference. Produce a polished photorealistic interior architectural visualization.`,
        image_urls: [body.imageDataUrl],
        num_inference_steps: 4,
        num_images: 1,
        output_format: 'jpeg',
        enable_safety_checker: true,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    const result = await upstream.json().catch(() => null) as { request_id?: string; queue_position?: number; detail?: string } | null
    if (!upstream.ok || !result?.request_id) return NextResponse.json({ error: result?.detail || 'Unable to submit the render.' }, { status: upstream.status || 502 })
    return NextResponse.json({ requestId: result.request_id, status: 'IN_QUEUE', queuePosition: result.queue_position }, { status: 202 })
  } catch (error) {
    console.error('FAL submission failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: 'Unable to reach the rendering provider.' }, { status: 502 })
  }
}

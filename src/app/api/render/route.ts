import { fal } from '@fal-ai/client'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300

const MODEL = 'fal-ai/flux-2/klein/9b/edit'

export async function POST(request: Request) {
  const key = process.env.FAL_KEY
  if (!key) return NextResponse.json({ error: 'Photorealistic rendering is not configured yet. Add FAL_KEY in Vercel.' }, { status: 503 })
  const body = await request.json().catch(() => null) as { imageDataUrl?: string; prompt?: string } | null
  if (!body?.imageDataUrl?.startsWith('data:image/')) return NextResponse.json({ error: 'A valid 3D camera snapshot is required.' }, { status: 400 })
  if (body.imageDataUrl.length > 4_000_000) return NextResponse.json({ error: 'The camera snapshot is too large.' }, { status: 413 })
  const prompt = body.prompt?.trim()
  if (!prompt || prompt.length > 1800) return NextResponse.json({ error: 'Enter a rendering prompt of up to 1,800 characters.' }, { status: 400 })

  fal.config({ credentials: key })
  try {
    const result = await fal.subscribe(MODEL, {
      input: {
        prompt: `${prompt}. Preserve the exact room geometry, wall positions, openings, camera angle and spatial proportions from the supplied 3D reference. Produce a polished photorealistic interior architectural visualization.`,
        image_urls: [body.imageDataUrl],
        num_images: 1,
        output_format: 'jpeg',
      },
      logs: false,
    })
    const data = result.data as { images?: Array<{ url?: string }> }
    const imageUrl = data.images?.[0]?.url
    if (!imageUrl) throw new Error('The rendering provider returned no image')
    return NextResponse.json({ imageUrl, requestId: result.requestId })
  } catch (error) {
    console.error('FAL rendering failed', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Rendering failed' }, { status: 502 })
  }
}

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MODEL_QUEUE = 'fal-ai/flux-2'
const BASE = `https://queue.fal.run/${MODEL_QUEUE}/requests`
const REQUEST_ID_RE = /^[A-Za-z0-9-]{20,80}$/

type Context = { params: Promise<{ requestId: string }> }

export async function GET(_request: Request, context: Context) {
  const key = process.env.FAL_KEY
  if (!key) return NextResponse.json({ error: 'Photorealistic rendering is not configured.' }, { status: 503 })
  const { requestId } = await context.params
  if (!REQUEST_ID_RE.test(requestId)) return NextResponse.json({ error: 'Invalid render request ID.' }, { status: 400 })

  const headers = { Authorization: `Key ${key}` }
  const encodedId = encodeURIComponent(requestId)
  try {
    const statusResponse = await fetch(`${BASE}/${encodedId}/status?logs=0`, { headers, cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    const status = await statusResponse.json().catch(() => null) as { status?: string; queue_position?: number; error?: string } | null
    if (!statusResponse.ok || !status?.status) return NextResponse.json({ error: 'Unable to retrieve render status.' }, { status: statusResponse.status || 502 })
    if (status.error) return NextResponse.json({ status: 'FAILED', error: status.error }, { status: 502 })
    if (status.status !== 'COMPLETED') return NextResponse.json({ requestId, status: status.status, queuePosition: status.queue_position })

    const resultResponse = await fetch(`${BASE}/${encodedId}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    const result = await resultResponse.json().catch(() => null) as { images?: Array<{ url?: string }> } | null
    const imageUrl = result?.images?.[0]?.url
    if (!resultResponse.ok || !imageUrl) return NextResponse.json({ error: 'The provider returned no render.' }, { status: resultResponse.status || 502 })
    return NextResponse.json({ requestId, status: 'COMPLETED', imageUrl })
  } catch (error) {
    console.error('FAL status check failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: 'Unable to reach the rendering provider.' }, { status: 502 })
  }
}

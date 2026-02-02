export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      return new Response(JSON.stringify({ ok: true, body }), {
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (e: any) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }
  return new Response(JSON.stringify({ ok: true, method: req.method }), {
    headers: { 'Content-Type': 'application/json' }
  })
}

/*
 * glory-event-inquiry — the Event Inquiry Form's backend (Cloudflare Worker).
 *
 * POST JSON {name, email, phone, date, summary, website, turnstileToken}
 * (src/ui/eventForm.ts's payload; `website` is the honeypot) →
 *   1. CORS: only ALLOWED_ORIGINS may post
 *   2. honeypot: a filled `website` is a bot → a quiet 200
 *   3. validation (the form's own rules: every field required)
 *   4. Turnstile: the token is checked with Cloudflare (TURNSTILE_SECRET)
 *   5. SendGrid: "Event Inquiry — <name>" to CONTACT_TO_EMAIL, reply-to the visitor
 * → 200 {ok: true} or 4xx/5xx {error}
 *
 * Secrets (wrangler secret put): SENDGRID_API_KEY, TURNSTILE_SECRET.
 */

export interface Env {
  SENDGRID_API_KEY: string
  TURNSTILE_SECRET: string
  CONTACT_TO_EMAIL?: string
  CONTACT_FROM_EMAIL?: string
  CONTACT_FROM_NAME?: string
  ALLOWED_ORIGINS?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const esc = (s: string) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
/** one line: trimmed, clipped, no line breaks (for the subject and headers) */
const line = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n]+/g, ' ').slice(0, n).trim()
const text = (s: unknown, n: number) => String(s ?? '').slice(0, n).trim()

/** "2026-11-14" → "Saturday, November 14, 2026 (2026-11-14)" */
function longDate(iso: string) {
  const m = DATE_RE.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const long = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  return `${long} (${iso})`
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') ?? ''
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const ok = allowed.includes(origin)
    const cors: Record<string, string> = ok
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : { Vary: 'Origin' }
    const json = (status: number, body: object) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } })

    if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: cors })
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
    if (!ok) return json(403, { error: 'Origin not allowed' })

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return json(400, { error: 'Bad request' })
    }
    // honeypot: real people never fill it
    if (body.website) return json(200, { ok: true })

    const name = line(body.name, 120)
    const email = line(body.email, 200)
    const phone = line(body.phone, 40)
    const date = line(body.date, 10)
    const summary = text(body.summary, 4000)
    if (!name || !email || !phone || !date || !summary) return json(400, { error: 'All form fields are required' })
    if (!EMAIL_RE.test(email)) return json(400, { error: 'That email address looks off' })
    const digits = phone.replace(/\D/g, '').length
    if (digits < 10 || digits > 20) return json(400, { error: 'That phone number looks off' })
    if (!DATE_RE.test(date)) return json(400, { error: 'That date looks off' })

    // Turnstile: is this a person?
    if (!env.TURNSTILE_SECRET) return json(500, { error: 'Verification is not configured' })
    const form = new FormData()
    form.append('secret', env.TURNSTILE_SECRET)
    form.append('response', text(body.turnstileToken, 4096))
    const ip = req.headers.get('CF-Connecting-IP')
    if (ip) form.append('remoteip', ip)
    const check = (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
      .then(r => r.json())
      .catch(() => ({ success: false }))) as { success?: boolean }
    if (!check.success) return json(400, { error: 'Please complete the verification' })

    // SendGrid
    if (!env.SENDGRID_API_KEY) return json(500, { error: 'Email service is not configured' })
    const to = env.CONTACT_TO_EMAIL || 'dave@gloryphilly.com'
    const from = env.CONTACT_FROM_EMAIL || 'noreply@gloryphilly.com'
    const fields: [string, string][] = [
      ['First and Last Name', name],
      ['Email', email],
      ['Phone Number', phone],
      ['Date of Event', longDate(date)],
    ]
    const plain = `${fields.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nSummary of Event:\n${summary}\n\nSent from the Event Inquiry Form at ${origin}`
    const html =
      `<table cellpadding="4" style="border-collapse:collapse;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif">` +
      fields.map(([k, v]) => `<tr><td style="color:#6b5a4e;padding-right:14px;white-space:nowrap">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join('') +
      `</table><p style="font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:18px 0 6px;color:#6b5a4e">Summary of Event</p>` +
      `<p style="font:15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:0">${esc(summary).replace(/\n/g, '<br>')}</p>` +
      `<p style="font:12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#999;margin-top:24px">Sent from the Event Inquiry Form at ${esc(origin)}</p>`
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: env.CONTACT_FROM_NAME || 'Glory website' },
        reply_to: { email, name },
        subject: `Event Inquiry — ${name}`,
        content: [
          { type: 'text/plain', value: plain },
          { type: 'text/html', value: html },
        ],
      }),
    })
    if (!res.ok) return json(502, { error: 'Could not send right now' })
    return json(200, { ok: true })
  },
}

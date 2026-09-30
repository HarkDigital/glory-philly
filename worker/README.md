# glory-event-inquiry

The backend for the Event Inquiry Form ("Book an Event"). It's a Cloudflare
Worker that checks the visitor's Turnstile token and then sends the inquiry
to Dave through SendGrid, as **Event Inquiry — <name>** with reply-to set to
the visitor. The site is static (GitHub Pages), so the keys live here and
never in the page.

**It isn't deployed yet.** Until it is, the form writes the inquiry into the
visitor's own email app (a `mailto:` addressed to dave@gloryphilly.com with
the subject "Event Inquiry" and every field in the body), and the button and
its note say so. This path already works on the static host.

## Go live (Mike, once)

1. **Turnstile widget.** Cloudflare dashboard → Turnstile → Add widget. Add
   the site's hostnames: `harkdigital.github.io`, `gloryphilly.com`,
   `www.gloryphilly.com`. Keep the **Site key** (public) and the
   **Secret key** (private).
2. **SendGrid.** Verify the sender in `CONTACT_FROM_EMAIL` in
   `wrangler.toml` (`noreply@gloryphilly.com`), or authenticate the
   gloryphilly.com domain. If you'd rather not touch Glory's DNS yet, use a
   sender that's already verified, such as `noreply@hark.digital`, and put
   it in `CONTACT_FROM_EMAIL`. Then create an API key with **Mail Send**
   access.
3. **Deploy.**

   ```bash
   cd worker
   npx wrangler login
   npx wrangler secret put TURNSTILE_SECRET     # the Turnstile Secret key
   npx wrangler secret put SENDGRID_API_KEY     # the SendGrid key
   npx wrangler deploy                          # prints the Worker URL
   ```

4. **Send Claude the Worker URL and the Turnstile Site key.** Don't send the
   Secret key or the SendGrid key: those stay in the Worker's secrets.

## Then Claude

Claude sets `EVENT_FORM.endpoint` (the Worker URL) and
`EVENT_FORM.turnstileSiteKey` (the Site key) in `src/content.ts`, then
builds, pushes, waits for the Pages deploy and sends one real test inquiry.
The button then reads "Send inquiry", and a sent inquiry shows "Request
sent." If either value is empty, the form goes back to the email-app path.

Inquiries go to `CONTACT_TO_EMAIL` (dave@gloryphilly.com). The sites allowed
to post are listed in `ALLOWED_ORIGINS`. Add the real domain there if it
changes.

## What it accepts

`POST` JSON `{ name, email, phone, date, summary, website, turnstileToken }`:

- `date` is `YYYY-MM-DD`, from the form's date picker.
- `website` is the honeypot. When it's filled in, the Worker returns a quiet
  `200` and sends nothing.
- Every field is required. The email address has to look valid, and the
  phone number needs 10 to 20 digits.

It replies with `200 {ok: true}`, or with `4xx`/`5xx` and `{error}`. The
form shows 4xx messages to the visitor, together with a pre-filled email to
Dave as a way around the problem.

## Try it locally

```bash
cd worker
printf 'TURNSTILE_SECRET=1x0000000000000000000000000000000AA\nSENDGRID_API_KEY=not-a-real-key\n' > .dev.vars
npx wrangler dev   # http://127.0.0.1:8787
```

The `1x…AA` values are Cloudflare's always-pass test keys. The matching
test site key is `1x00000000000000000000AA`. To point the dev site at the
local Worker, set `EVENT_FORM.endpoint = 'http://127.0.0.1:8787'` and
`turnstileSiteKey = '1x00000000000000000000AA'` for the session, and don't
commit them. With the fake SendGrid key, a valid inquiry gets as far as
SendGrid and comes back `502 {"error":"Could not send right now"}`.
`.dev.vars` is gitignored (`worker/.gitignore`).

```bash
curl -i -X POST http://127.0.0.1:8787 \
  -H 'Origin: http://localhost:6980' -H 'Content-Type: application/json' \
  -d '{"name":"Jane Doe","email":"jane@example.com","phone":"215 555 0100","date":"2026-11-14","summary":"Birthday dinner, about 25 guests.","website":"","turnstileToken":"XXXX.DUMMY.TOKEN.XXXX"}'
```

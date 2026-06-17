# pcphone remote — web client

A single static page (`index.html`, no build step) that lets a phone sign in with
the same Supabase account as the desktop app and remote-control the PC. Video is
peer-to-peer over WebRTC; signaling goes through Supabase Realtime; input is sent
over a WebRTC data channel.

After login it **auto-detects** your online PC session (or reads `?room=CODE` from
the URL), so you usually don't type anything.

## Deploy to Vercel

The easiest path (no CLI):

1. Push this repo to GitHub.
2. In Vercel → **Add New… → Project** → import the repo.
3. Set **Root Directory** to `web`. Leave the framework as **Other** (it's static —
   no build command needed). Deploy.
4. You get a URL like `https://your-app.vercel.app`.

Or with the CLI, from this `web/` folder:

```bash
npm i -g vercel
vercel --prod
```

## Point the desktop QR at your site (optional)

So scanning the QR opens your Vercel site instead of the raw edge function, set an
env var before launching the desktop app:

```bash
# macOS/Linux
PCPHONE_WEB_URL=https://your-app.vercel.app npm start

# Windows (PowerShell)
$env:PCPHONE_WEB_URL="https://your-app.vercel.app"; npm start
```

(Or add `PCPHONE_WEB_URL=https://your-app.vercel.app` to a `.env` in the repo root.)
The desktop will then show/QR `https://your-app.vercel.app?room=CODE`.

## Config

The Supabase project URL + publishable anon key are embedded at the top of the
`<script>` in `index.html` (both are public; Row-Level Security governs access).
Change them there if you move to a different Supabase project.

## Notes

- Requires the desktop app running and signed in (that registers the room).
- Across strict/cellular NATs, plain STUN may not connect — a TURN server may be
  needed for true off-network use.

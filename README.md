# Instagram/IP Telegram API

TypeScript + Express + Node.js API designed for Vercel. It uses the same Instagram upstreams as the supplied Python script, geolocates the requester's IP, and sends the formatted result to the configured Telegram chat.

## Endpoints

- `GET /api/health`
- `GET /api/search?username=yukimigeru` — Instagram profile + caller IP geolocation, then Telegram notification
- `GET /api/instagram/yukimigeru`
- `GET /api/ip/me`
- `GET /api/ip/8.8.8.8`

The `/api/search` response includes both structured JSON and the human-readable `output` string. A direct Python client can call it with `requests.get("https://YOUR-DOMAIN.vercel.app/api/search", params={"username": "yukimigeru"})`; the server determines the caller IP from Vercel forwarding headers.

## Run locally

```bash
npm install
npm run build
npm run dev
```

Then open `http://localhost:3000/api/search?username=yukimigeru`.

## Deploy to Vercel

```bash
npm install -g vercel
vercel login
vercel --prod
```

No Vercel environment variables are required because the Telegram values are hardcoded as requested. **The bot token was provided in plaintext; rotate it with BotFather if this repository or chat is public.**

The upstream Instagram services and `ipwho.is` can rate-limit or change behavior, so the API reports when a lookup is unavailable instead of treating it as a valid profile.

# StarDay

What photo did Hubble take on the day you were born? Enter your birthdate and discover the Hubble/JWST image NASA captured around that day — title, short caption and HD link.

## Fonti (in ordine)

Solo due, nessuna altra:

1. **NASA APOD** — `https://api.nasa.gov/planetary/apod?date=YYYY-MM-DD&api_key=NASA_API_KEY` (disponibile dal 1995-06-16, solo `media_type=image`)
2. **Fallback NASA Images** — `https://images-api.nasa.gov/search?q=Hubble+Space+Telescope+OR+James+Webb+Space+Telescope&media_type=image&year_start=YYYY&year_end=YYYY` — seleziona `date_created` più vicino a `requestedDate`

## Endpoint (contratto)

```
POST /api/astro  { date: 'YYYY-MM-DD' }
GET  /api/astro?date=YYYY-MM-DD
```

Successo:

```json
{
  "imageUrl": "string (URL HD, mai raw/FITS, https)",
  "title": "string",
  "caption": "string (max 300 char da explanation)",
  "source": "NASA APOD | NASA Image Library (Hubble/JWST fallback)",
  "creditedTo": "string (copyright o NASA/ESA/STScI)",
  "actualDate": "YYYY-MM-DD",
  "isFallback": false,
  "requestedDate": "YYYY-MM-DD"
}
```

Errore:

```json
{ "error": "messaggio user-friendly", "code": "INVALID_DATE | RATE_LIMIT | NOT_FOUND | UPSTREAM_ERROR" }
```

## Configurazione

### NASA_API_KEY su Vercel

1. Genera la key su https://api.nasa.gov/
2. Vercel → Project → Settings → Environment Variables → aggiungi `NASA_API_KEY` (Production + Preview + Development)
3. Redeploy

> La key resta solo lato server (route `/api/astro`). Mai esporla al client.

### DEMO_KEY

`DEMO_KEY` solo in sviluppo locale (`NODE_ENV=development`). In produzione serve sempre una key personale, altrimenti 429/403 con retry o messaggio user-friendly.

Locale:

```bash
echo "NASA_API_KEY=DEMO_KEY" > .env.local  # solo dev
# oppure
echo "NASA_API_KEY=la_tua_key_reale" > .env.local
```

## Stack

Next.js (App Router) + Route Handler `/api/astro` + TypeScript.

## Comandi

```bash
npm install
npm run dev    # http://localhost:3000
npm run build  # build di produzione
npm start      # avvia build prodotta
```

## Note immagini

- Solo immagini **già renderizzate** (JPEG/PNG). **Mai** raw, FITS, heatmap o dati scientifici grezzi.
- `imageUrl` sempre `https` e HD (`hdurl` di APOD o asset NASA Images).
- APOD video o non-image → passa al fallback.
- Gestiti 429/403 con retry o messaggio d'errore.

## Deploy su Vercel

1. Push su GitHub
2. Vercel → Add New Project → Import repository
3. Imposta `NASA_API_KEY` nelle Environment Variables
4. Deploy — ogni push su `main` redeploya automaticamente

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

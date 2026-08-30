# Filing renderer

Builds a court filing PDF from a bundle: cover, index, the pleading, and each
appendix behind its own separator sheet, numbered sequentially and split when it
passes what נט המשפט accepts.

It exists as a separate service because the main app runs on Cloudflare Workers,
which refuse to compile the WebAssembly that PDF layout needs. This is plain
Node, so it just works.

## What it does not do

Nothing here talks to נט המשפט. It produces the file; a lawyer uploads it and
records the date in LEXA by hand.

## Running it locally

```sh
npm install
npm test          # the assembly, on PDFs it builds itself — no Supabase needed
npm start         # needs the two secrets below
```

## Deploying

Cloud Run builds the container remotely, so Docker is not needed locally — only
the gcloud CLI.

```sh
gcloud run deploy lexa-filing-renderer \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars SUPABASE_URL=https://<project>.supabase.co \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=lexa-service-role:latest
```

`--allow-unauthenticated` refers to Google's own layer. The service does its own
checking: see below.

### Region

`europe-west1` keeps client documents in the EU, matching where the database
lives. Cloud Run's always-free allowance covers US regions only, so this costs a
little. During development, with test data and no real client files, a US region
is free and moves nothing that matters — the service stores nothing.

## How it authenticates

The browser calls this service directly, so a shared secret was the wrong
design: it would ship to every user. Instead the caller sends their own Supabase
token, the service verifies it, and checks that the caller belongs to the firm
that owns the bundle before doing any work.

The service role key is held here and nowhere else. This is the only component
permitted to bypass row level security, which is why it re-checks membership
itself rather than trusting the request.

## Secrets

| Name | Where it comes from |
| --- | --- |
| `SUPABASE_URL` | Project settings. Not secret. |
| `SUPABASE_SERVICE_ROLE_KEY` | Project API keys. **Secret Manager only** — never in the repo, never in the browser. |

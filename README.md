# LEXA

ניהול משרד עורכי דין קטן, בעברית. לקוחות, תיקים, מסמכים, יומן, משימות וחיוב —
במקום אחד, בענן, בלי שרת במשרד.

**האתר החי:** https://yosef120-prog.github.io/lexa/

---

## Where things are

| | |
|---|---|
| `src/lib/` | Data access and the rules. One module per subject. |
| `src/screens/` | Whole screens. |
| `src/components/` | Panels that appear inside screens. |
| `supabase/migrations/` | The schema, and most of the actual rules. |
| `services/filing-renderer/` | A separate Cloud Run service that assembles court filings. |
| `test/` | Runs against a real Postgres in-process. No mocks. |
| `.github/workflows/` | Deploy on push; reminder mail on a schedule. |

**Most of the product is in the migrations, not in the React.** Row level
security decides what each role can see and do, `SECURITY DEFINER` functions
carry anything that has to happen atomically, and the client is a way to look
at that. When a rule and a screen disagree, the rule wins — deliberately.

---

## Running it

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_ANON_KEY
npm run dev
```

Node 22 or newer. The dev server is on port 5175.

```bash
npm test        # 208 checks, no network needed
npm run build
npm run typecheck
```

`npm test` spins up Postgres in-process via PGlite, applies every migration in
order, and exercises the policies as four different users. It is the fastest
way to know whether a change to the schema broke tenant isolation, and it runs
before every deploy.

---

## How it ships

Push to `main`. That is the whole process.

The `Deploy` workflow runs the tests, refuses to continue if any fail, builds
the site and publishes it to GitHub Pages. Separately, Supabase's GitHub
integration applies any new migration in `supabase/migrations/`. Both are free,
with no clock on them, which is why they were chosen.

Migration filenames **must** be `<timestamp>_name.sql` or Supabase silently
ignores them.

The filing renderer is deployed by hand to Cloud Run — it changes rarely, and
the source-based deploy needs no local Docker:

```bash
gcloud run deploy lexa-filing-renderer --source services/filing-renderer --region europe-west1
```

---

## Keys

Three values ship inside the browser bundle and are public by design:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_RENDERER_URL`. They live
as repository **variables**. Row level security is what protects the data,
which is why the migrations spend so much care on it.

Two are genuinely secret and live as repository **secrets**, used only by the
reminder job: `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY`. The service
role key bypasses RLS entirely. It does not belong in a terminal, a chat
window, or any committed file.

---

## Reminders

A diary entry gets `remind_at` — 24 hours before, unless someone says
otherwise. Two things then use it:

- **A band across the top of the app**, on every tab, for whoever opens it.
- **A daily digest at 09:00 Israel time**, sent by `scripts/send-reminders.mjs`.

The mail currently reaches one address only: the one that owns the Resend
account. That is Resend's rule for sending without a verified domain, and the
mail says so in its own footer. Connecting a domain is the only change needed —
nothing in the code has to move.

Whoever leads the matter is warned, and so is whoever entered the date. Those
are often different people, and warning only the second would reach the wrong
desk.

---

## Things that are deliberately not here

The brief names these, and they stay out until real firms are paying:

- **An execution-proceedings module.** Dozens of forms, and nobody has asked.
- **Scraping Net HaMishpat.** No stable API, and legal risk in scraping it. The
  app prepares the filing; a person uploads it.
- **Issuing tax invoices.** A regulated act. Morning or iCount issues; LEXA
  records which invoice covers which demand.
- **AI on client documents.** Privileged material does not leave this
  infrastructure.
- **Virus scanning.** The only free option shares samples with third parties,
  which is a confidentiality problem for privileged documents. Uploads are
  checked against their own first bytes, and the screen says plainly that this
  is not a scan. Real scanning wants ClamAV on Cloud Run, at a real cost.

---

## Known gaps

- **Document files are not in the export.** The records come out; the files
  stay in storage and are downloaded per matter.
- **The reminder mail reaches one address** until a domain is connected.
- **Two-step sign-in is available but off** until an owner enables it.

---

## Conventions

- Code in English, Hebrew only in what a user reads.
- UUIDs everywhere.
- Deleting is almost always marking `deleted_at`, never removing a row.
- Anything on a matter's timeline is append-only. No policy grants UPDATE or
  DELETE on `matter_activity`, to anyone.
- Errors reach the screen in Hebrew, through `describeDbError`. Constraint
  names and schema-cache messages belong in the console.

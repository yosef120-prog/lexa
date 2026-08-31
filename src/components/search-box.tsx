import { useEffect, useRef, useState } from "react";
import { KIND_LABEL, searchFirm, type SearchHit } from "@/lib/search";

export function SearchBox({
  onOpenMatter,
  onOpenClients,
}: {
  onOpenMatter: (id: string) => void;
  onOpenClients: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Waits for a pause in typing. Querying every keystroke would send four
  // requests for a four letter name and show the answer to the third one.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setError(null);
      return;
    }

    setBusy(true);
    const id = setTimeout(async () => {
      try {
        setHits(await searchFirm(q));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    }, 250);

    return () => clearTimeout(id);
  }, [query]);

  // Clicking anywhere else closes the results, which is what people expect of
  // something that hangs over the page.
  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  function choose(hit: SearchHit) {
    setOpen(false);
    setQuery("");
    if (hit.matter_id) onOpenMatter(hit.matter_id);
    else onOpenClients();
  }

  return (
    <div ref={box} className="relative w-full max-w-md">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder="חיפוש: שם, תיק, ת.ז., מספר בנט"
        aria-label="חיפוש במשרד"
        className="w-full rounded-md border border-rule bg-surface px-3 py-2 text-sm outline-none
                   focus:border-brand focus:ring-2 focus:ring-brand/20"
      />

      {open && query.trim() && (
        <div
          className="absolute z-40 mt-1 max-h-96 w-full overflow-y-auto rounded-md border
                     border-rule bg-surface shadow-lg"
        >
          {error ? (
            <p className="px-3 py-2.5 text-sm text-danger">{error}</p>
          ) : busy && hits.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted">מחפש...</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-ink-soft">
              לא נמצא כלום עבור «{query.trim()}».
            </p>
          ) : (
            <ul>
              {hits.map((hit) => (
                <li key={`${hit.kind}-${hit.id}`}>
                  <button
                    onClick={() => choose(hit)}
                    className="flex w-full flex-col items-start gap-0.5 border-b border-rule px-3
                               py-2.5 text-start last:border-0 hover:bg-ground"
                  >
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="rounded bg-ground px-1.5 py-0.5 text-xs font-semibold text-ink-soft">
                        {KIND_LABEL[hit.kind]}
                      </span>
                      {hit.ref_no !== null && (
                        <span className="font-mono text-xs text-muted">#{hit.ref_no}</span>
                      )}
                      <span className="font-semibold">{hit.title}</span>
                    </span>
                    {hit.subtitle && (
                      <span className="text-xs text-muted">{hit.subtitle}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

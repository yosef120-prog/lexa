import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  formatSize,
  getDownloadUrl,
  uploadDocument,
  type DocumentGroup,
  type DocumentRow,
} from "@/lib/documents";
import { Button, Card, ErrorNote } from "@/components/ui";

export function DocumentsPanel({
  matterId,
  groups,
  onChanged,
}: {
  matterId: string;
  groups: DocumentGroup[];
  onChanged: () => void;
}) {
  const { membership } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pendingGroup, setPendingGroup] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  function pick(versionGroupId?: string) {
    setPendingGroup(versionGroupId);
    setError(null);
    fileInput.current?.click();
  }

  async function onFile(file: File | undefined) {
    if (!file || !membership) return;
    setBusy(true);
    setError(null);
    try {
      await uploadDocument({
        org_id: membership.org_id,
        matter_id: matterId,
        file,
        version_group_id: pendingGroup,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setPendingGroup(undefined);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">מסמכים</h2>
        <Button onClick={() => pick(undefined)} disabled={busy}>
          {busy ? "מעלה..." : "העלה מסמך"}
        </Button>
      </div>

      <input
        ref={fileInput}
        type="file"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {groups.length === 0 ? (
        <p className="text-sm text-ink-soft">
          עוד לא הועלו מסמכים. העלאה חוזרת של אותו מסמך יוצרת גרסה חדשה ולא דורסת את הקודמת.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule">
          {groups.map((g) => (
            <li key={g.version_group_id} className="flex flex-col gap-1.5 py-3 first:pt-0">
              <DocumentLine doc={g.latest} onError={setError} />

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <button
                  onClick={() => pick(g.version_group_id)}
                  disabled={busy}
                  className="font-semibold text-brand underline underline-offset-2"
                >
                  העלה גרסה חדשה
                </button>
                {g.older.length > 0 && (
                  <button
                    onClick={() =>
                      setExpanded(expanded === g.version_group_id ? null : g.version_group_id)
                    }
                    className="text-ink-soft underline underline-offset-2"
                  >
                    {expanded === g.version_group_id
                      ? "הסתר גרסאות קודמות"
                      : `${g.older.length} גרסאות קודמות`}
                  </button>
                )}
              </div>

              {expanded === g.version_group_id && (
                <ul className="mt-1 flex flex-col gap-1.5 border-r-2 border-rule pe-0 ps-3">
                  {g.older.map((d) => (
                    <li key={d.id}>
                      <DocumentLine doc={d} onError={setError} muted />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Said once, where files are handled, because a lawyer uploading a
          client's contract is entitled to know what the system does not do. */}
      <p className="border-t border-rule pt-2 text-xs text-muted">
        קבצים אינם נסרקים לווירוסים. קישורי ההורדה פגים תוך דקה.
      </p>
    </Card>
  );
}

function DocumentLine({
  doc,
  onError,
  muted = false,
}: {
  doc: DocumentRow;
  onError: (m: string) => void;
  muted?: boolean;
}) {
  const [opening, setOpening] = useState(false);

  async function open() {
    setOpening(true);
    try {
      // Fetched at click time, not at render: a URL minted when the list loaded
      // would already have expired.
      const url = await getDownloadUrl(doc);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="flex items-baseline justify-between gap-3">
      <button
        onClick={open}
        disabled={opening}
        className={`text-start font-semibold underline underline-offset-2 ${
          muted ? "text-ink-soft" : "text-ink"
        }`}
      >
        {doc.filename}
      </button>
      <span className="shrink-0 text-xs text-muted">
        גרסה {doc.version_no}
        {doc.size_bytes !== null && ` · ${formatSize(doc.size_bytes)}`}
      </span>
    </div>
  );
}

import { useState, type ChangeEvent } from "react";
import {
  formatSize,
  getDownloadUrl,
  softDeleteDocument,
  uploadDocument,
  type DocumentGroup,
  type DocumentRow,
} from "@/lib/documents";
import { DeleteButton } from "@/components/delete-button";
import { Card, ErrorNote } from "@/components/ui";

/**
 * Files that belong to the person rather than to a file.
 *
 * The same table and the same versioning as a matter's documents — what
 * differs is only which column they hang off, so nothing here reimplements
 * uploading or downloading.
 */
export function ClientDocuments({
  orgId,
  clientId,
  groups,
  onChanged,
}: {
  orgId: string;
  clientId: string;
  groups: DocumentGroup[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Cleared straight away so choosing the same file twice still fires.
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      await uploadDocument({ org_id: orgId, client_id: clientId, file });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">מסמכי הלקוח</h2>
        <label className="cursor-pointer text-sm font-semibold text-brand underline underline-offset-2">
          {busy ? "מעלה..." : "העלה מסמך"}
          <input type="file" className="hidden" onChange={pick} disabled={busy} />
        </label>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {groups.length === 0 ? (
        <p className="text-sm text-ink-soft">
          אין מסמכים על הלקוח עצמו. מה שהוא שולח בשאלון נוחת כאן, וגם אפשר להעלות ידנית.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule">
          {groups.map((g) => (
            <DocRow key={g.version_group_id} group={g} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function DocRow({ group, onChanged }: { group: DocumentGroup; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);

  async function open(doc: DocumentRow) {
    setError(null);
    try {
      window.open(await getDownloadUrl(doc), "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const { latest, older } = group;

  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <button
          onClick={() => open(latest)}
          className="min-w-0 flex-1 truncate text-start text-sm font-semibold text-brand underline underline-offset-2"
        >
          {latest.filename}
        </button>
        <span className="shrink-0 text-xs text-muted">{formatSize(latest.size_bytes)}</span>
        <DeleteButton
          small
          label="מחק"
          what={latest.filename}
          consequence="המסמך יירד מהכרטיס. הקובץ עצמו נשמר, כי מסמך שהוסר עשוי עדיין להידרש."
          onDelete={async () => {
            await softDeleteDocument(latest.id);
            onChanged();
          }}
        />
      </div>
      <span className="text-xs text-muted">
        {new Date(latest.created_at).toLocaleDateString("he-IL")}
        {/* Where it came from, which is not the same question as who is in the
            room. A file the client sent through the link has no member behind
            it, and saying so is the difference between a record of what the
            client produced and a blank. */}
        {latest.intake_id
          ? " · נשלח על ידי הלקוח בשאלון"
          : latest.uploader && ` · ${latest.uploader.full_name || latest.uploader.email}`}
        {older.length > 0 && ` · ${older.length} גרסאות קודמות`}
      </span>
      {error && <ErrorNote>{error}</ErrorNote>}
    </li>
  );
}

import { useState } from "react";
import { ErrorNote } from "@/components/ui";

/**
 * Deleting something, with the consequence said before the click.
 *
 * One component rather than three, because three would drift: one would ask
 * for confirmation and another would not, and the one that did not would be
 * the one holding a client's identity documents.
 *
 * The confirmation is deliberately not a browser dialog. Those are dismissed
 * by reflex, they cannot say what is about to happen in the reader's language,
 * and they cannot be seen at the same time as the thing being deleted.
 *
 * Every button here declares type="button", and that is not a formality. A
 * button inside a <form> with no type is a submit button, and this component
 * is rendered inside the client edit form: without it, pressing "delete"
 * saved the form and closed it, the confirmation never appeared, and deleting
 * a client was impossible from the screen that offers it.
 */
export function DeleteButton({
  label,
  what,
  consequence,
  onDelete,
  small = false,
}: {
  /** The word on the resting button. */
  label: string;
  /** What is being deleted, named, so the confirmation is unambiguous. */
  what: string;
  /** What changes afterwards, in the reader's terms. */
  consequence: string;
  onDelete: () => Promise<void>;
  small?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`rounded font-semibold text-danger hover:bg-danger/10 ${
            small ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
          }`}
        >
          {label}
        </button>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md bg-danger/10 p-3">
      <p className="text-sm font-semibold text-danger">למחוק את {what}?</p>
      <p className="text-xs text-ink-soft">{consequence}</p>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={go}
          disabled={busy}
          className="rounded-md bg-danger px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "מוחק..." : "מחק"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-rule/50"
        >
          השאר
        </button>
      </div>
    </div>
  );
}

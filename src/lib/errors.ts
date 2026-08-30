import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Turns a database error into something a lawyer can act on.
 *
 * PostgREST speaks in schema caches and constraint names. Those belong in the
 * console, where they help whoever is fixing it, and never on screen, where
 * they only tell the reader that something broke in a language aimed at
 * somebody else.
 */
export function describeDbError(error: PostgrestError | Error): string {
  const message = error.message ?? "";
  const code = "code" in error ? error.code : undefined;

  // Row level security refused the write. Almost always a role that may read
  // but not change — an intern, by design.
  if (code === "42501" || message.includes("row-level security")) {
    return "אין לך הרשאה לבצע את הפעולה הזו.";
  }

  if (code === "23505") return "הרשומה הזו כבר קיימת.";
  if (code === "23503") return "פריט מקושר חסר או נמחק.";

  // The schema is behind the app: a migration has not been applied yet.
  if (message.includes("schema cache") || code === "PGRST205") {
    return "חלק מהמערכת עוד לא הותקן במסד הנתונים. פנה למי שמתחזק את המערכת.";
  }

  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return "אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב.";
  }

  console.error("database error", error);
  return "משהו השתבש. נסה שוב, ואם זה חוזר — פנה לתמיכה.";
}

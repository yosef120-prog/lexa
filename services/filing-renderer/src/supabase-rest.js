/**
 * A small REST client for Supabase, built on plain fetch.
 *
 * It replaced @supabase/supabase-js here after every call from this container
 * failed with an opaque "fetch failed" while an ordinary fetch to the same host
 * succeeded. Rather than keep guessing at a library's internals, the service
 * now makes the requests itself: the same ones, with headers it controls, and
 * errors that say what the server actually answered.
 *
 * A browser has good reasons to use the full client. A server making six known
 * calls does not.
 */

/**
 * Header values cannot contain control characters. A secret pasted with a
 * trailing newline produces exactly that, and the resulting failure names
 * neither the header nor the key.
 */
function sanitise(value, name) {
  const clean = String(value).replace(/[\r\n\t]/g, "").trim();
  if (!clean) throw new Error(`${name} is empty`);
  if (/[^\x20-\x7e]/.test(clean)) {
    throw new Error(`${name} contains characters that cannot go in a header`);
  }
  return clean;
}

export function createRest({ url, key }) {
  const base = sanitise(url, "SUPABASE_URL").replace(/\/+$/, "");
  const apiKey = sanitise(key, "SUPABASE_SERVICE_ROLE_KEY");

  const headers = {
    apikey: apiKey,
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };

  async function call(path, init = {}) {
    const target = `${base}${path}`;
    // A header set to undefined still reaches fetch as the string "undefined";
    // dropping the key is what actually omits it.
    const merged = { ...headers, ...init.headers };
    for (const [name, value] of Object.entries(merged)) {
      if (value === undefined) delete merged[name];
    }

    let res;
    try {
      res = await fetch(target, { ...init, headers: merged });
    } catch (error) {
      // Unwrapped here, because Node buries the reason and the caller only ever
      // sees "fetch failed" otherwise.
      const cause = error.cause?.message ?? error.cause?.code ?? "";
      throw new Error(`cannot reach ${path}: ${error.message}${cause ? ` (${cause})` : ""}`);
    }
    return res;
  }

  async function json(path, init) {
    const res = await call(path, init);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    /** PostgREST select. `query` is everything after the table name. */
    async select(table, query) {
      return json(`/rest/v1/${table}?${query}`);
    },

    async selectOne(table, query) {
      const rows = await json(`/rest/v1/${table}?${query}&limit=1`);
      return rows?.[0] ?? null;
    },

    async insert(table, row, { returning = false } = {}) {
      const rows = await json(`/rest/v1/${table}`, {
        method: "POST",
        headers: { prefer: returning ? "return=representation" : "return=minimal" },
        body: JSON.stringify(row),
      });
      return returning ? (rows?.[0] ?? null) : null;
    },

    async update(table, query, patch) {
      await json(`/rest/v1/${table}?${query}`, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
    },

    async downloadObject(bucket, path) {
      const res = await call(`/storage/v1/object/${bucket}/${encodePath(path)}`, {
        headers: { "content-type": undefined },
      });
      if (!res.ok) {
        throw new Error(`cannot read ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    },

    async uploadObject(bucket, path, bytes, contentType) {
      const res = await call(`/storage/v1/object/${bucket}/${encodePath(path)}`, {
        method: "POST",
        headers: { "content-type": contentType },
        body: bytes,
      });
      if (!res.ok) {
        throw new Error(`upload failed → ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    },
  };
}

/** Each segment separately: the slashes are structure, not content. */
function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * Verifies a user's token. Uses the publishable key on purpose — establishing
 * who someone is needs no privilege, and the secret key is not accepted here.
 */
export async function verifyToken({ url, publishableKey, authHeader }) {
  if (!authHeader?.startsWith("Bearer ")) return null;

  const base = sanitise(url, "SUPABASE_URL").replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: sanitise(publishableKey, "SUPABASE_PUBLISHABLE_KEY"), authorization: authHeader },
    });
  } catch (error) {
    console.error("could not reach the auth endpoint", error);
    return null;
  }

  if (!res.ok) {
    console.warn(`token rejected by Supabase: ${res.status}`);
    return null;
  }

  const user = await res.json().catch(() => null);
  return user?.id ?? null;
}

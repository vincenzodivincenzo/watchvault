// Goodreads CSV → Arca book items.
//
// Goodreads has had no public API since 2020, so the CSV export is the only
// first-party route in. Everything below is written against the real export
// format: Goodreads → My Books → Import and Export → Export Library.

// Minimal RFC 4180 parser. Goodreads quotes any field containing a comma or a
// newline, and review text routinely contains both, so splitting on commas
// silently corrupts about a fifth of a real library.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  // Strip a UTF-8 BOM; Goodreads includes one and it corrupts the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvToObjects(text) {
  const rows = parseCsv(text).filter((r) => r.length > 1);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
    return o;
  });
}

// Goodreads writes ISBNs as ="9780143127741" so spreadsheets keep the leading
// zeros. Unwrap to the bare digits, or null when the field is the empty ="".
function isbn(raw) {
  const v = (raw || "").replace(/^="?|"?$/g, "").trim();
  return /^\d{9}[\dXx]$|^\d{13}$/.test(v) ? v : null;
}

// "2026/08/21" → "2026-08-21". Dates are stored as the calendar day only; a
// Goodreads date has no time and inventing one would be a lie.
function gdate(raw) {
  const m = (raw || "").match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function num(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

// Goodreads' "Exclusive Shelf" is the one authoritative status per book.
const STATUS = {
  read: "read",
  "currently-reading": "reading",
  "to-read": "to-read",
  "stopped-reading": "abandoned",
};

export function bookFromGoodreads(r) {
  const shelf = STATUS[r["Exclusive Shelf"]] || "to-read";
  const dateRead = gdate(r["Date Read"]);
  const rating = num(r["My Rating"]) || null;
  const shelves = (r["Bookshelves"] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    uuid: crypto.randomUUID(),
    kind: "book",
    goodreadsId: r["Book Id"] || null,
    title: r["Title"] || "Untitled",
    author: r["Author"] || null,
    isbn: isbn(r["ISBN13"]) || isbn(r["ISBN"]),
    year: num(r["Original Publication Year"]) || num(r["Year Published"]),
    pages: num(r["Number of Pages"]),
    status: shelf,
    isWatched: shelf === "read", // "consumed", shared with films for shared stats
    watchedAt: dateRead ? `${dateRead}T12:00:00.000Z` : null,
    rating: rating && rating > 0 ? rating : null,
    isFavorite: false,
    rewatchCount: Math.max(0, (num(r["Read Count"]) || 1) - 1),
    review: r["My Review"] || null,
    notes: r["Private Notes"] || null,
    tags: shelves,
    createdAt: gdate(r["Date Added"])
      ? `${gdate(r["Date Added"])}T12:00:00.000Z`
      : new Date().toISOString(),
    meta: null, // filled in later from Open Library
  };
}

function key(b) {
  return b.isbn || b.goodreadsId || `${b.title}|${b.author}`.toLowerCase();
}

// Merges into an existing shelf. Never downgrades a status and never un-reads
// a book, matching how the TV Time importer treats watch state.
export function importGoodreadsCsv(text, existing = []) {
  const objs = csvToObjects(text);
  const out = [...existing];
  const index = new Map(out.map((b) => [key(b), b]));
  const report = { added: 0, merged: 0, skipped: 0 };

  for (const r of objs) {
    if (!r["Title"]) {
      report.skipped++;
      continue;
    }
    const b = bookFromGoodreads(r);
    const k = key(b);
    const cur = index.get(k);
    if (!cur) {
      out.push(b);
      index.set(k, b);
      report.added++;
    } else {
      if (b.isWatched && !cur.isWatched) {
        cur.isWatched = true;
        cur.status = "read";
        cur.watchedAt = b.watchedAt || cur.watchedAt;
      }
      cur.rating = cur.rating ?? b.rating;
      cur.review = cur.review || b.review;
      cur.pages = cur.pages || b.pages;
      cur.isbn = cur.isbn || b.isbn;
      cur.rewatchCount = Math.max(cur.rewatchCount || 0, b.rewatchCount || 0);
      report.merged++;
    }
  }
  return { books: out, report };
}

// ---------------------------------------------------------------------------
// Open Library. Free, no key, no rate limit worth worrying about at this size.

const OL = "https://openlibrary.org";

export function coverUrl(book, size = "M") {
  if (book.meta?.coverId) {
    return `https://covers.openlibrary.org/b/id/${book.meta.coverId}-${size}.jpg`;
  }
  if (book.isbn) {
    return `https://covers.openlibrary.org/b/isbn/${book.isbn}-${size}.jpg`;
  }
  return null;
}

/**
 * Search every book Open Library knows about, not just the shelf.
 *
 * No language filter: it does not translate the displayed title (Karamazov
 * still comes back in Cyrillic) and it excludes non-English works entirely,
 * which would hide half of this library. Ranking by edition count instead
 * puts the canonical work above summaries and single-edition reprints.
 */
export async function searchBooks(query, { signal, limit = 20 } = {}) {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams({
    q,
    limit: String(limit),
    fields:
      "key,title,author_name,first_publish_year,cover_i,number_of_pages_median,edition_count,isbn,subject",
  });
  const res = await fetch(`${OL}/search.json?${params}`, { signal });
  if (!res.ok) throw new Error(`Open Library ${res.status}`);
  const data = await res.json();
  return (data.docs || [])
    .map((d) => ({
      workKey: d.key,
      title: d.title || "Untitled",
      author: d.author_name?.[0] || null,
      year: d.first_publish_year || null,
      pages: d.number_of_pages_median || null,
      coverId: d.cover_i || null,
      editions: d.edition_count || 0,
      isbn: (d.isbn || [])[0] || null,
      subjects: (d.subject || []).slice(0, 6),
    }))
    .sort((a, b) => b.editions - a.editions);
}

// A search result becomes a shelf item. Defaults to to-read; pass a status
// to log something already finished.
export function bookFromSearch(r, { status = "to-read", dateIso = null } = {}) {
  return {
    uuid: crypto.randomUUID(),
    kind: "book",
    goodreadsId: null,
    workKey: r.workKey || null,
    title: r.title,
    author: r.author,
    isbn: r.isbn,
    year: r.year,
    pages: r.pages,
    status,
    isWatched: status === "read",
    watchedAt: status === "read" ? dateIso || new Date().toISOString() : null,
    rating: null,
    isFavorite: false,
    rewatchCount: 0,
    review: null,
    notes: null,
    tags: [],
    createdAt: new Date().toISOString(),
    meta: {
      coverId: r.coverId ?? null,
      pages: r.pages ?? null,
      subjects: r.subjects || [],
      blurb: null,
    },
  };
}

// Titles rarely match exactly across sources: Goodreads keeps the full
// subtitle ("Existential Kink: Unmask Your Shadow and Embrace Your Power")
// where Open Library keeps the work title ("Existential Kink"). Compare the
// part before the first colon, punctuation and case removed.
function mainTitle(t) {
  return (t || "")
    .split(/[:(]/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Surname only: "Fyodor Dostoyevsky" and "Фёдор Михайлович Достоевский" will
// never agree, but "Carolyn Elliott" and "Elliott, Carolyn" should.
function surname(a) {
  const parts = (a || "")
    .toLowerCase()
    .replace(/[^a-z\s,]/g, "")
    .split(/[,\s]+/)
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

// True when the shelf already holds this result. Imported books carry no work
// key, so an exact-id match alone misses every one of them.
export function alreadyOnShelf(books, r) {
  const rt = mainTitle(r.title);
  const rs = surname(r.author);
  return (books || []).some((b) => {
    if (r.isbn && b.isbn && b.isbn === r.isbn) return true;
    if (r.workKey && b.workKey && b.workKey === r.workKey) return true;
    if (!rt) return false;
    const bt = mainTitle(b.title);
    if (bt !== rt) return false;
    // Same main title is not enough on its own: a summary or companion volume
    // often repeats it. Require the author to line up too.
    const bs = surname(b.author);
    return !rs || !bs || bs === rs;
  });
}

export function needsBookMeta(books) {
  return books.filter((b) => !b.meta && !b.metaFailed).length;
}

async function lookup(book, signal) {
  if (book.isbn) {
    const res = await fetch(`${OL}/isbn/${book.isbn}.json`, { signal });
    if (res.ok) return res.json();
  }
  const q = new URLSearchParams({
    title: book.title,
    ...(book.author ? { author: book.author } : {}),
    limit: "1",
  });
  const res = await fetch(`${OL}/search.json?${q}`, { signal });
  if (!res.ok) throw new Error(`Open Library ${res.status}`);
  const data = await res.json();
  const d = data.docs?.[0];
  if (!d) return null;
  return {
    covers: d.cover_i ? [d.cover_i] : [],
    number_of_pages: d.number_of_pages_median,
    subjects: d.subject?.slice(0, 6),
    first_sentence: d.first_sentence?.[0],
    _work: d.key,
  };
}

// Fills covers and blurbs in the background, one book at a time so a 446-book
// shelf does not open 446 sockets. onItem patches a single book so the UI can
// fill in progressively instead of freezing on a batch.
export async function enrichBooks(books, { signal, onItem, onProgress } = {}) {
  const pending = books.filter((b) => !b.meta && !b.metaFailed);
  let left = pending.length;
  for (const b of pending) {
    if (signal?.aborted) return;
    try {
      const d = await lookup(b, signal);
      onItem?.(b.uuid, {
        meta: {
          coverId: d?.covers?.[0] ?? null,
          pages: d?.number_of_pages ?? b.pages ?? null,
          subjects: d?.subjects ?? [],
          blurb:
            typeof d?.description === "string"
              ? d.description
              : d?.description?.value || d?.first_sentence || null,
        },
      });
    } catch (e) {
      if (e.name === "AbortError") return;
      onItem?.(b.uuid, { metaFailed: true });
    }
    onProgress?.(--left);
    await new Promise((r) => setTimeout(r, 120)); // be a good citizen
  }
}

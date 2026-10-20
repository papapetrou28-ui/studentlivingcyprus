import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import { getUser, type User } from "@netlify/identity";

const db = getDatabase();
const query = async (text: string, params: unknown[] = []): Promise<any[]> => (await db.pool.query(text, params)).rows;
const photos = () => getStore({ name: "listing-photos", consistency: "strong" });

const TYPES = ["Apartment", "Studio", "Room"];
const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

const isAdmin = (user: User | null) => !!user && (user.roles?.includes("admin") || user.role === "admin");

async function requireUser() {
  const user = await getUser();
  if (!user) throw new HttpError(401, "Please log in first.");
  return user;
}

async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) throw new HttpError(403, "Admins only.");
  return user;
}

function text(value: unknown, max: number, field?: string) {
  const s = String(value ?? "").trim().slice(0, max);
  if (field && !s) throw new HttpError(400, `${field} is required.`);
  return s;
}

function int(value: unknown, min: number, max: number, field: string) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${field} must be between ${min} and ${max}.`);
  return n;
}

const optionalId = (value: unknown) => (value == null || value === "" ? null : int(value, 1, 2 ** 31 - 1, "id"));

// Public shape of a listing; the owner's email is only revealed to signed-in users.
function publicListing(row: any, viewer: User | null) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    area: row.area,
    rent: row.rent,
    beds: row.beds,
    deposit: row.deposit,
    bills: row.bills,
    description: row.description,
    photos: (row.photos || []).map((key: string) => `/api/photos/${key}`),
    featured: !!row.featured_until && new Date(row.featured_until) > new Date(),
    createdAt: row.created_at,
    email: viewer ? row.email : undefined,
    isOwner: !!viewer && row.owner_id === viewer.id,
  };
}

function ownListing(row: any, viewer: User) {
  return { ...publicListing(row, viewer), status: row.status, rejectReason: row.reject_reason, views: row.views };
}

const routes: Array<[string, RegExp, (req: Request, m: RegExpMatchArray) => Promise<Response>]> = [
  ["GET", /^\/me$/, async () => {
    const user = await getUser();
    return json({ user: user ? { id: user.id, email: user.email, name: user.name } : null, isAdmin: isAdmin(user) });
  }],

  // ---------- Listings ----------
  ["GET", /^\/listings$/, async (req) => {
    const url = new URL(req.url);
    const params: unknown[] = [];
    const where = ["status = 'approved'"];
    const q = url.searchParams.get("q")?.trim();
    if (q) {
      params.push(`%${q}%`);
      where.push(`(title ILIKE $${params.length} OR area ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }
    const type = url.searchParams.get("type");
    if (type && TYPES.includes(type)) {
      params.push(type);
      where.push(`type = $${params.length}`);
    }
    const max = Number(url.searchParams.get("max"));
    if (max > 0) {
      params.push(max);
      where.push(`rent <= $${params.length}`);
    }
    const limit = Math.min(Number(url.searchParams.get("limit")) || 60, 100);
    const rows = await query(
      `SELECT * FROM listings WHERE ${where.join(" AND ")}
       ORDER BY (featured_until IS NOT NULL AND featured_until > now()) DESC, created_at DESC LIMIT ${limit}`,
      params,
    );
    const viewer = await getUser();
    return json(rows.map((r) => publicListing(r, viewer)));
  }],

  ["GET", /^\/listings\/(\d+)$/, async (_req, m) => {
    const viewer = await getUser();
    const [row] = await query("SELECT * FROM listings WHERE id = $1", [m[1]]);
    const visible = row && (row.status === "approved" || row.owner_id === viewer?.id || isAdmin(viewer));
    if (!visible) throw new HttpError(404, "Listing not found.");
    if (row.status === "approved" && row.owner_id !== viewer?.id) {
      await query("UPDATE listings SET views = views + 1 WHERE id = $1", [row.id]);
    }
    return json(publicListing(row, viewer));
  }],

  ["POST", /^\/listings$/, async (req) => {
    const user = await requireUser();
    const body = await req.json();
    const type = text(body.type, 20, "Property type");
    if (!TYPES.includes(type)) throw new HttpError(400, "Choose a valid property type.");
    const [row] = await query(
      `INSERT INTO listings (title, type, area, rent, beds, deposit, bills, email, description, owner_token, owner_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,'pending') RETURNING *`,
      [
        text(body.title, 90, "Title"),
        type,
        text(body.area, 80, "Area"),
        int(body.rent, 1, 20000, "Rent"),
        int(body.beds || 0, 0, 20, "Bedrooms"),
        int(body.deposit || 0, 0, 50000, "Deposit"),
        int(body.bills || 0, 0, 10000, "Bills"),
        text(body.email || user.email, 200, "Contact email"),
        text(body.description, 1500),
        user.id,
      ],
    );
    return json(ownListing(row, user), 201);
  }],

  // Photos are uploaded one per request to stay well under the function payload limit.
  ["POST", /^\/listings\/(\d+)\/photos$/, async (req, m) => {
    const user = await requireUser();
    const [row] = await query("SELECT owner_id, photos FROM listings WHERE id = $1", [m[1]]);
    if (!row || row.owner_id !== user.id) throw new HttpError(404, "Listing not found.");
    if ((row.photos || []).length >= MAX_PHOTOS) throw new HttpError(400, `You can upload up to ${MAX_PHOTOS} photos.`);
    const type = req.headers.get("content-type") || "";
    if (!PHOTO_TYPES.includes(type)) throw new HttpError(400, "Photos must be JPG, PNG, WebP or GIF.");
    const data = await req.arrayBuffer();
    if (!data.byteLength || data.byteLength > MAX_PHOTO_BYTES) throw new HttpError(400, "Each photo must be under 4 MB.");
    const key = `${m[1]}/${crypto.randomUUID()}`;
    await photos().set(key, data, { metadata: { contentType: type } });
    await query("UPDATE listings SET photos = photos || $1::jsonb WHERE id = $2", [JSON.stringify([key]), m[1]]);
    return json({ url: `/api/photos/${key}` }, 201);
  }],

  ["DELETE", /^\/listings\/(\d+)$/, async (_req, m) => {
    const user = await requireUser();
    const [row] = await query("SELECT * FROM listings WHERE id = $1", [m[1]]);
    if (!row || (row.owner_id !== user.id && !isAdmin(user))) throw new HttpError(404, "Listing not found.");
    await query("DELETE FROM listings WHERE id = $1", [row.id]);
    await Promise.all((row.photos || []).map((key: string) => photos().delete(key)));
    return json({ ok: true });
  }],

  ["GET", /^\/photos\/(\d+\/[\w-]+)$/, async (_req, m) => {
    const result = await photos().getWithMetadata(m[1], { type: "stream" });
    if (!result) throw new HttpError(404, "Photo not found.");
    return new Response(result.data, {
      headers: {
        "content-type": String(result.metadata.contentType || "image/jpeg"),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }],

  // ---------- Roommates ----------
  ["GET", /^\/roommates$/, async () => {
    const viewer = await getUser();
    const rows = await query("SELECT * FROM roommates ORDER BY created_at DESC LIMIT 100");
    return json(rows.map((r) => ({
      id: r.id, name: r.name, budget: r.budget, area: r.area, about: r.about, createdAt: r.created_at,
      isOwner: !!viewer && r.owner_id === viewer.id,
    })));
  }],

  ["POST", /^\/roommates$/, async (req) => {
    const user = await requireUser();
    const body = await req.json();
    const [row] = await query(
      "INSERT INTO roommates (owner_id, name, budget, area, about) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [user.id, text(body.name, 50, "Display name"), int(body.budget, 1, 10000, "Budget"), text(body.area, 80), text(body.about, 600)],
    );
    return json({ ...row, isOwner: true }, 201);
  }],

  ["DELETE", /^\/roommates\/(\d+)$/, async (_req, m) => {
    const user = await requireUser();
    const rows = isAdmin(user)
      ? await query("DELETE FROM roommates WHERE id = $1 RETURNING id", [m[1]])
      : await query("DELETE FROM roommates WHERE id = $1 AND owner_id = $2 RETURNING id", [m[1], user.id]);
    if (!rows.length) throw new HttpError(404, "Post not found.");
    return json({ ok: true });
  }],

  // ---------- Dashboard ----------
  ["GET", /^\/my$/, async () => {
    const user = await requireUser();
    const [listings, roommates] = await Promise.all([
      query("SELECT * FROM listings WHERE owner_id = $1 ORDER BY created_at DESC", [user.id]),
      query("SELECT * FROM roommates WHERE owner_id = $1 ORDER BY created_at DESC", [user.id]),
    ]);
    return json({ listings: listings.map((r) => ownListing(r, user)), roommates: roommates.map((r) => ({ ...r, isOwner: true })) });
  }],

  // ---------- Messages ----------
  ["GET", /^\/messages$/, async () => {
    const user = await requireUser();
    const rows = await query(
      `SELECT m.*, l.title AS listing_title, r.name AS roommate_name
       FROM messages m
       LEFT JOIN listings l ON l.id = m.listing_id
       LEFT JOIN roommates r ON r.id = m.roommate_id
       WHERE m.recipient_id = $1 OR m.sender_id = $1
       ORDER BY m.created_at ASC LIMIT 1000`,
      [user.id],
    );
    // Group into conversations: one per (listing or roommate post, other person).
    const threads = new Map<string, any>();
    for (const r of rows) {
      const mine = r.sender_id === user.id;
      const other = mine ? r.recipient_id : r.sender_id;
      const key = `${r.listing_id ?? ""}:${r.roommate_id ?? ""}:${other}`;
      if (!threads.has(key)) {
        threads.set(key, {
          key,
          listingId: r.listing_id,
          roommateId: r.roommate_id,
          otherId: other,
          otherName: r.listing_id ? "Landlord" : r.roommate_name || "Student",
          subject: r.listing_title ? `Listing: ${r.listing_title}` : r.roommate_name ? `Roommate post: ${r.roommate_name}` : "Removed post",
          unread: 0,
          messages: [],
        });
      }
      const t = threads.get(key);
      if (!mine) {
        t.otherName = r.sender_name || r.sender_email;
        if (!r.read) t.unread++;
      }
      t.messages.push({ id: r.id, body: r.body, mine, createdAt: r.created_at });
    }
    const list = [...threads.values()].sort(
      (a, b) => +new Date(b.messages.at(-1).createdAt) - +new Date(a.messages.at(-1).createdAt),
    );
    return json(list);
  }],

  ["POST", /^\/messages$/, async (req) => {
    const user = await requireUser();
    const body = await req.json();
    const listingId = optionalId(body.listingId);
    const roommateId = listingId ? null : optionalId(body.roommateId);
    if (!listingId && !roommateId) throw new HttpError(400, "Choose a listing or roommate post.");
    const message = text(body.body, 2000, "Message");

    const [post] = listingId
      ? await query("SELECT owner_id FROM listings WHERE id = $1 AND status = 'approved'", [listingId])
      : await query("SELECT owner_id FROM roommates WHERE id = $1", [roommateId]);
    if (!post) throw new HttpError(404, "That post is no longer available.");

    let recipient = post.owner_id;
    if (recipient === user.id) {
      // The owner can only reply to someone who already wrote to them about this post.
      const to = text(body.to, 100, "Recipient");
      const [prior] = await query(
        "SELECT 1 FROM messages WHERE sender_id = $1 AND recipient_id = $2 AND listing_id IS NOT DISTINCT FROM $3 AND roommate_id IS NOT DISTINCT FROM $4 LIMIT 1",
        [to, user.id, listingId, roommateId],
      );
      if (!prior) throw new HttpError(400, "You can't message yourself.");
      recipient = to;
    }
    if (!recipient) throw new HttpError(400, "This post can't receive messages.");

    const [row] = await query(
      `INSERT INTO messages (listing_id, roommate_id, sender_id, sender_name, sender_email, recipient_id, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
      [listingId, roommateId, user.id, user.name || "", user.email || "", recipient, message],
    );
    return json(row, 201);
  }],

  ["POST", /^\/messages\/read$/, async (req) => {
    const user = await requireUser();
    const body = await req.json();
    await query(
      "UPDATE messages SET read = true WHERE recipient_id = $1 AND sender_id = $2 AND listing_id IS NOT DISTINCT FROM $3 AND roommate_id IS NOT DISTINCT FROM $4",
      [user.id, text(body.otherId, 100, "otherId"), optionalId(body.listingId), optionalId(body.roommateId)],
    );
    return json({ ok: true });
  }],

  ["GET", /^\/messages\/unread$/, async () => {
    const user = await getUser();
    if (!user) return json({ count: 0 });
    const [row] = await query("SELECT count(*)::int AS count FROM messages WHERE recipient_id = $1 AND read = false", [user.id]);
    return json(row);
  }],

  // ---------- Reports and business enquiries ----------
  ["POST", /^\/reports$/, async (req) => {
    const body = await req.json();
    const kind = body.kind === "advertise" ? "advertise" : "report";
    const user = await getUser();
    await query(
      "INSERT INTO reports (listing_id, roommate_id, kind, reason, message, email) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        optionalId(body.listingId),
        optionalId(body.roommateId),
        kind,
        text(body.reason, 120, kind === "advertise" ? "Business name" : "Reason"),
        text(body.message, 2000),
        text(body.email || user?.email, 200, "Email"),
      ],
    );
    return json({ ok: true }, 201);
  }],

  // ---------- Ads (student deals) ----------
  ["GET", /^\/ads$/, async () => {
    const rows = await query(
      "SELECT id, business, title, description, url, tier FROM ads WHERE starts_at <= now() AND ends_at > now() ORDER BY tier = 'featured' DESC, created_at DESC",
    );
    return json(rows);
  }],

  ["GET", /^\/ads\/(\d+)\/go$/, async (_req, m) => {
    const [row] = await query("UPDATE ads SET clicks = clicks + 1 WHERE id = $1 RETURNING url", [m[1]]);
    if (!row?.url) throw new HttpError(404, "Offer not found.");
    return Response.redirect(row.url, 302);
  }],

  // ---------- Admin ----------
  ["GET", /^\/admin\/overview$/, async () => {
    await requireAdmin();
    const [pending, recent, reports, ads] = await Promise.all([
      query("SELECT * FROM listings WHERE status = 'pending' ORDER BY created_at ASC"),
      query("SELECT * FROM listings WHERE status <> 'pending' ORDER BY created_at DESC LIMIT 50"),
      query("SELECT * FROM reports WHERE resolved = false ORDER BY created_at DESC"),
      query("SELECT * FROM ads ORDER BY ends_at DESC LIMIT 50"),
    ]);
    const shape = (r: any) => ({ ...publicListing(r, { id: "" } as User), status: r.status, rejectReason: r.reject_reason, views: r.views, featuredUntil: r.featured_until });
    return json({ pending: pending.map(shape), recent: recent.map(shape), reports, ads });
  }],

  ["POST", /^\/admin\/listings\/(\d+)$/, async (req, m) => {
    await requireAdmin();
    const body = await req.json();
    if (body.action === "approve") {
      await query("UPDATE listings SET status = 'approved', reject_reason = '' WHERE id = $1", [m[1]]);
    } else if (body.action === "reject") {
      await query("UPDATE listings SET status = 'rejected', reject_reason = $2 WHERE id = $1", [m[1], text(body.reason, 300)]);
    } else if (body.action === "feature") {
      const days = int(body.days ?? 30, 0, 365, "Days");
      await query(
        "UPDATE listings SET featured_until = CASE WHEN $2::int = 0 THEN NULL ELSE now() + make_interval(days => $2::int) END WHERE id = $1",
        [m[1], days],
      );
    } else {
      throw new HttpError(400, "Unknown action.");
    }
    return json({ ok: true });
  }],

  ["POST", /^\/admin\/reports\/(\d+)\/resolve$/, async (_req, m) => {
    await requireAdmin();
    await query("UPDATE reports SET resolved = true WHERE id = $1", [m[1]]);
    return json({ ok: true });
  }],

  ["POST", /^\/admin\/ads$/, async (req) => {
    await requireAdmin();
    const body = await req.json();
    const url = text(body.url, 500);
    if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, "Website must start with http:// or https://");
    const [row] = await query(
      "INSERT INTO ads (business, title, description, url, tier, ends_at) VALUES ($1,$2,$3,$4,$5, now() + make_interval(days => $6::int)) RETURNING *",
      [
        text(body.business, 100, "Business"),
        text(body.title, 120, "Offer title"),
        text(body.description, 600),
        url,
        body.tier === "featured" ? "featured" : "deal",
        int(body.days ?? 30, 1, 365, "Days"),
      ],
    );
    return json(row, 201);
  }],

  ["DELETE", /^\/admin\/ads\/(\d+)$/, async (_req, m) => {
    await requireAdmin();
    await query("DELETE FROM ads WHERE id = $1", [m[1]]);
    return json({ ok: true });
  }],
];

export default async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/$/, "") || "/";
  try {
    // Reject cross-site writes; the session cookie would otherwise ride along.
    if (req.method !== "GET") {
      const origin = req.headers.get("origin");
      if (origin && origin !== url.origin) throw new HttpError(403, "Cross-site request blocked.");
    }
    for (const [method, pattern, handler] of routes) {
      const m = path.match(pattern);
      if (m && method === req.method) return await handler(req, m);
    }
    throw new HttpError(404, "Not found.");
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    if (err instanceof SyntaxError) return json({ error: "Invalid request body." }, 400);
    console.error(err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};

export const config: Config = {
  path: "/api/*",
};

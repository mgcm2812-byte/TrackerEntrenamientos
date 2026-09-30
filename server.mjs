import { createServer } from "node:http";
import { createReadStream, mkdirSync, existsSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { XMLParser } from "fast-xml-parser";
import FitParser from "fit-file-parser";
import { generateHybridPlan, assessWeeklyAdaptation, ALGORITHM_CONFIG } from "./algorithm.mjs";

const scrypt = promisify(scryptCb);
const root = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || join(root, "data"));
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, "stride.sqlite"));
db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1)), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS goal (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plans (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, version INTEGER NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(user_id, version));
CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, file_hash TEXT, created_at TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(user_id, file_hash));
CREATE TABLE IF NOT EXISTS proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, data TEXT NOT NULL);`);

// Upgrade the original single-user schema. Its data is retained in the seeded admin account.
// Initial CREATEs above are only suitable for fresh databases; rebuild any pre-user tables before using them.
// SQLite's legacy table shape is detected from the database before the request server starts.
for (const table of ["profile", "goal", "plans", "activities", "proposals"]) {
  const cols = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name);
  if (!cols.includes("user_id")) {
    const legacy = `legacy_${table}`;
    db.exec(`ALTER TABLE ${table} RENAME TO ${legacy}`);
    const definitions = {
      profile:
        "CREATE TABLE profile (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL)",
      goal: "CREATE TABLE goal (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL)",
      plans:
        "CREATE TABLE plans (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, version INTEGER NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(user_id, version))",
      activities:
        "CREATE TABLE activities (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, file_hash TEXT, created_at TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(user_id, file_hash))",
      proposals:
        "CREATE TABLE proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL)",
    }[table];
    const colsToCopy =
      table === "profile" || table === "goal"
        ? ["user_id", "data"]
        : [
            "id",
            "user_id",
            ...(table === "plans"
              ? ["version", "created_at", "data"]
              : table === "activities"
                ? ["file_hash", "created_at", "data"]
                : ["status", "created_at", "data"]),
          ];
    db.exec(
      `${definitions}; INSERT INTO ${table} (${colsToCopy.join(",")}) SELECT ${colsToCopy.map((column) => (column === "user_id" ? "1" : column)).join(",")} FROM ${legacy}; DROP TABLE ${legacy};`,
    );
  }
}
db.exec(`CREATE INDEX IF NOT EXISTS plans_by_user ON plans(user_id, version);
CREATE INDEX IF NOT EXISTS activities_by_user ON activities(user_id, created_at);
CREATE INDEX IF NOT EXISTS proposals_by_user ON proposals(user_id, status, id);`);

const sessions = new Map();
const loginFailures = new Map();
const sessionTtl = 12 * 60 * 60 * 1000;
const port = Number(
  process.env.PORT || (process.env.NODE_ENV === "production" ? 4178 : 4178),
);

function json(res, status, body, extra = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extra,
  });
  res.end(JSON.stringify(body));
}
function rowJson(row) {
  return row ? JSON.parse(row.data) : null;
}
function scaleSessionDuration(session, duration) {
  const previous = Math.max(1, Number(session.durationMin) || duration);
  const ratio = duration / previous;
  session.durationMin = duration;
  if (session.distanceKm) session.distanceKm = Math.round(session.distanceKm * ratio * 10) / 10;
  if (session.load) for (const key of Object.keys(session.load)) session.load[key] = Math.round(Number(session.load[key] || 0) * ratio);
  if (session.sessionLoad) session.sessionLoad = Math.round(session.sessionLoad * ratio);
  if (session.impactLoad) session.impactLoad = Math.round(session.impactLoad * ratio);
  return session;
}
async function bodyBuffer(req, max = 8 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max)
      throw Object.assign(
        new Error("La solicitud supera el límite de tamaño admitido."),
        {
          status: 413,
        },
      );
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function bodyJson(req, maxBytes = 8 * 1024 * 1024) {
  const raw = await bodyBuffer(req, maxBytes);
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw Object.assign(new Error("El contenido JSON no es válido."), {
      status: 400,
    });
  }
}
function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split(/=(.*)/s).slice(0, 2))
      .filter(([k, v]) => k && v),
  );
}
function secureCookie(token, maxAge = 43200) {
  return `stride_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}
async function passwordHash(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${Buffer.from(derived).toString("hex")}`;
}
async function verifyPassword(password, saved) {
  if (typeof password !== "string" || !saved) return false;
  const [salt, key] = saved.split(":");
  try {
    const candidate = Buffer.from(
      await scrypt(password, Buffer.from(salt, "hex"), 64),
    );
    const expected = Buffer.from(key, "hex");
    return (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    );
  } catch {
    return false;
  }
}
const adminHash = await passwordHash("admin");
db.prepare(
  "INSERT OR IGNORE INTO users(username,password_hash,is_admin,created_at) VALUES('admin',?,1,?)",
).run(adminHash, new Date().toISOString());
db.exec("PRAGMA foreign_keys=ON");
function sessionUser(req) {
  const token = cookies(req).stride_session;
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  session.expires = Date.now() + sessionTtl;
  return session;
}
function profile(userId) {
  return rowJson(
    db.prepare("SELECT data FROM profile WHERE user_id=?").get(userId),
  );
}
function goal(userId) {
  return rowJson(
    db.prepare("SELECT data FROM goal WHERE user_id=?").get(userId),
  );
}
function latestPlan(userId) {
  return rowJson(
    db
      .prepare(
        "SELECT data FROM plans WHERE user_id=? ORDER BY version DESC LIMIT 1",
      )
      .get(userId),
  );
}
function latestProposal(userId) {
  const row = db
    .prepare(
      "SELECT id, status, created_at, data FROM proposals WHERE user_id=? AND status='pending' ORDER BY id DESC LIMIT 1",
    )
    .get(userId);
  return row
    ? {
        id: row.id,
        status: row.status,
        createdAt: row.created_at,
        ...JSON.parse(row.data),
      }
    : null;
}
function activities(userId, includeFitData = false) {
  return db
    .prepare(
      "SELECT id, created_at, data FROM activities WHERE user_id=? ORDER BY created_at DESC",
    )
    .all(userId)
    .map((row) => {
      const activity = JSON.parse(row.data);
      if (!includeFitData) delete activity.fitData;
      return { id: row.id, createdAt: row.created_at, ...activity };
    });
}
function saveSingleton(table, userId, data) {
  db.prepare(
    `INSERT INTO ${table} (user_id,data) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data`,
  ).run(userId, JSON.stringify(data));
}
function parseDate(value) {
  return new Date(`${value}T00:00:00`);
}
const days = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];
const strengthCatalog = {
  divisions: ["Torso/Pierna", "FullBody", "Tirón/Empuje/Pierna"],
  groups: {
    Espalda: ["Dominadas", "Jalón", "Remo en máquina", "Remo gironda"],
    Pecho: ["Press en máquina inclinado", "Press en máquina", "Press con mancuernas", "Fondos paralelas", "Aperturas"],
    Hombro: ["Press militar máquina", "Press militar mancuernas", "Elevaciones laterales mancuernas", "Pájaros en máquina"],
    Brazo: ["Curl bíceps mancuerna", "Extensión tríceps polea", "Curl bíceps barra", "Press tríceps barra"],
    Pierna: ["Prensa", "Sentadilla multipower", "Hip Thrust", "Prensa horizontal", "Extensiones cuádriceps", "Curl femoral tumbado", "Curl femoral sentado", "Abductor", "Adductor", "Gemelo en máquina"],
    Core: ["Planchas", "Crunch abdominal", "Press Pallof"],
  },
};
const defaultStrengthConfig = { division: "Torso/Pierna", exercises: Object.values(strengthCatalog.groups).flat() };
function strengthConfig() {
  const row = db.prepare("SELECT data FROM app_settings WHERE key='strength'").get();
  return row ? JSON.parse(row.data) : defaultStrengthConfig;
}
function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function isoDay(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}
function haversine(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function invalidFile(message) {
  return Object.assign(new Error(message), { status: 400 });
}
async function parseActivity(buffer, filename) {
  const ext = extname(filename).toLowerCase();
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  let data;
  if (ext === ".gpx") {
    const xml = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: true,
    }).parse(buffer.toString("utf8"));
    const gpx = xml.gpx;
    const tracks = Array.isArray(gpx?.trk)
      ? gpx.trk
      : gpx?.trk
        ? [gpx.trk]
        : [];
    const points = tracks.flatMap((t) =>
      (Array.isArray(t.trkseg) ? t.trkseg : [t.trkseg])
        .filter(Boolean)
        .flatMap((s) =>
          Array.isArray(s.trkpt) ? s.trkpt : s.trkpt ? [s.trkpt] : [],
        ),
    );
    const coords = points
      .map((pt) => ({
        lat: Number(pt["@_lat"]),
        lon: Number(pt["@_lon"]),
        time: Date.parse(pt.time),
      }))
      .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lon));
    if (coords.length < 2)
      throw invalidFile(
        "El GPX debe contener al menos dos puntos de track con coordenadas válidas.",
      );
    let km = 0;
    for (let i = 1; i < coords.length; i++)
      km += haversine(coords[i - 1], coords[i]);
    const validTimes = coords.map((p) => p.time).filter(Number.isFinite);
    data = {
      source: "GPX",
      date: validTimes.length
        ? new Date(Math.min(...validTimes)).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      type: "run",
      distanceKm: Math.round(km * 100) / 100,
      durationMin:
        validTimes.length > 1
          ? Math.round(
              (Math.max(...validTimes) - Math.min(...validTimes)) / 60000,
            )
          : null,
      avgHeartRate: null,
      note: "Importado desde GPX. Comprueba la duración y completa el esfuerzo percibido.",
    };
  } else if (ext === ".fit") {
    let parsed;
    try {
      parsed = await new FitParser({
        mode: "list",
        lengthUnit: "km",
        speedUnit: "km/h",
        elapsedRecordField: true,
        includeUnmappedMessages: true,
        includeRawDeveloperFields: true,
        includeRawMessages: true,
        force: false,
      }).parseAsync(buffer);
    } catch {
      throw invalidFile(
        "No se pudo leer el FIT. Comprueba que el archivo sea una actividad FIT válida y completa.",
      );
    }
    const session = parsed.sessions?.at(-1);
    if (!session)
      throw invalidFile(
        "No se encontró una sesión de actividad en el archivo FIT.",
      );
    const startTime =
      session.start_time instanceof Date
        ? session.start_time
        : new Date(session.start_time);
    const sport = String(
      session.sport || session.sub_sport || "",
    ).toLowerCase();
    const type = /strength|training|workout/.test(sport)
      ? "strength"
      : /cycling|ride|swim|walking|hiking/.test(sport)
        ? "other"
        : "run";
    data = {
      source: "FIT",
      date: Number.isNaN(startTime.getTime())
        ? new Date().toISOString().slice(0, 10)
        : startTime.toISOString().slice(0, 10),
      type,
      distanceKm: Number(session.total_distance) || null,
      durationMin:
        Math.round(
          Number(session.total_elapsed_time || session.total_timer_time || 0) /
            60,
        ) || null,
      avgHeartRate: Number(session.avg_heart_rate) || null,
      maxHeartRate: Number(session.max_heart_rate) || null,
      note: "Importado desde FIT. Revisa los datos y añade RPE y sensaciones.",
      fitData: parsed,
    };
  } else
    throw invalidFile(
      "Formato no admitido. Selecciona un archivo .FIT o .GPX.",
    );
  if (!data.distanceKm && !data.durationMin)
    throw invalidFile(
      "El archivo no contiene distancia o duración reconocible.",
    );
  return { fileHash, activity: data };
}

function exportData(userId) {
  return {
    format: "stride-backup-v1",
    exportedAt: new Date().toISOString(),
    profile: profile(userId),
    goal: goal(userId),
    plans: db
      .prepare(
        "SELECT version, created_at AS createdAt, data FROM plans WHERE user_id=? ORDER BY version",
      )
      .all(userId)
      .map((r) => ({
        version: r.version,
        createdAt: r.createdAt,
        ...JSON.parse(r.data),
      })),
    activities: activities(userId, true).map(({ id, createdAt, ...rest }) => ({
      ...rest,
      createdAt,
    })),
    proposals: db
      .prepare(
        "SELECT status, created_at AS createdAt, data FROM proposals WHERE user_id=?",
      )
      .all(userId)
      .map((r) => ({
        status: r.status,
        createdAt: r.createdAt,
        ...JSON.parse(r.data),
      })),
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );
  const pathname = decodeURIComponent(url.pathname);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  try {
    if (pathname === "/api/health" && req.method === "GET")
      return json(res, 200, { ok: true });
    if (pathname === "/api/session" && req.method === "GET") {
      const session = sessionUser(req);
      return json(res, 200, {
        authenticated: Boolean(session),
        username: session?.username || null,
        isAdmin: Boolean(session?.isAdmin),
      });
    }
    if (pathname === "/api/register" && req.method === "POST") {
      const { username, password } = await bodyJson(req);
      const normalized = typeof username === "string" ? username.trim() : "";
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(normalized))
        return json(res, 400, {
          error:
            "El login debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.",
        });
      if (
        typeof password !== "string" ||
        password.length < 6 ||
        password.length > 256
      )
        return json(res, 400, {
          error: "La contraseña debe tener al menos 6 caracteres.",
        });
      const hash = await passwordHash(password);
      try {
        const result = db
          .prepare(
            "INSERT INTO users(username,password_hash,is_admin,created_at) VALUES(?,?,0,?)",
          )
          .run(normalized, hash, new Date().toISOString());
        const user = {
          userId: Number(result.lastInsertRowid),
          username: normalized,
          isAdmin: false,
        };
        const token = randomBytes(32).toString("hex");
        sessions.set(token, { ...user, expires: Date.now() + sessionTtl });
        return json(
          res,
          201,
          { ok: true, username: normalized, isAdmin: false },
          { "Set-Cookie": secureCookie(token) },
        );
      } catch (error) {
        if (String(error.message).includes("UNIQUE"))
          return json(res, 409, { error: "Ese login ya está en uso." });
        throw error;
      }
    }
    if (pathname === "/api/login" && req.method === "POST") {
      const address = req.socket.remoteAddress || "local";
      const failures = loginFailures.get(address);
      if (failures?.blockedUntil > Date.now())
        return json(res, 429, {
          error: "Demasiados intentos. Espera unos minutos y vuelve a probar.",
        });
      const { username, password } = await bodyJson(req);
      const saved = db
        .prepare(
          "SELECT id, username, password_hash, is_admin FROM users WHERE username=? COLLATE NOCASE",
        )
        .get(typeof username === "string" ? username.trim() : "");
      if (
        typeof password !== "string" ||
        password.length > 256 ||
        (password.length < 6 &&
          !(
            typeof username === "string" &&
            username.trim().toLowerCase() === "admin" &&
            password === "admin"
          )) ||
        !saved ||
        !(await verifyPassword(password, saved.password_hash))
      ) {
        const count = (failures?.count || 0) + 1;
        loginFailures.set(address, {
          count,
          blockedUntil: count >= 5 ? Date.now() + 15 * 60 * 1000 : 0,
        });
        return json(res, 401, { error: "Login o contraseña incorrectos." });
      }
      loginFailures.delete(address);
      const token = randomBytes(32).toString("hex");
      sessions.set(token, {
        userId: saved.id,
        username: saved.username,
        isAdmin: Boolean(saved.is_admin),
        expires: Date.now() + sessionTtl,
      });
      return json(
        res,
        200,
        {
          ok: true,
          username: saved.username,
          isAdmin: Boolean(saved.is_admin),
        },
        { "Set-Cookie": secureCookie(token) },
      );
    }
    if (pathname === "/api/logout" && req.method === "POST") {
      const token = cookies(req).stride_session;
      if (token) sessions.delete(token);
      return json(
        res,
        200,
        { ok: true },
        { "Set-Cookie": secureCookie("", 0) },
      );
    }
    if (pathname.startsWith("/api/")) {
      const session = sessionUser(req);
      if (!session)
        return json(res, 401, { error: "Inicia sesión para continuar." });
      const userId = session.userId;
      if (pathname.startsWith("/api/admin/")) {
        if (!session.isAdmin)
          return json(res, 403, {
            error: "Solo el administrador puede realizar esta acción.",
          });
        if (pathname === "/api/admin/strength" && req.method === "GET")
          return json(res, 200, { config: strengthConfig(), catalog: strengthCatalog });
        if (pathname === "/api/admin/strength" && req.method === "PUT") {
          const config = await bodyJson(req);
          if (!Array.isArray(config.exercises)) return json(res,400,{error:"Selecciona ejercicios del catálogo."});
          const allowed = new Set(Object.values(strengthCatalog.groups).flat());
          const selected = new Set(config.exercises || []);
          const hasGroup = (group) => strengthCatalog.groups[group].some((name) => selected.has(name));
          const coverage = config.division === "FullBody"
            ? hasGroup("Pierna") && (hasGroup("Espalda") || hasGroup("Pecho")) && (hasGroup("Hombro") || hasGroup("Brazo"))
            : config.division === "Torso/Pierna"
              ? hasGroup("Pierna") && hasGroup("Espalda") && hasGroup("Pecho")
              : hasGroup("Espalda") && hasGroup("Pecho") && hasGroup("Pierna");
          if (!strengthCatalog.divisions.includes(config.division) || !Array.isArray(config.exercises) || !config.exercises.length || config.exercises.some((name) => !allowed.has(name)) || new Set(config.exercises).size !== config.exercises.length || !coverage)
            return json(res, 400, { error: "La selección debe incluir ejercicios adecuados a cada parte de la división (torso y pierna; cuerpo completo; o tirón, empuje y pierna)." });
          db.prepare("INSERT INTO app_settings(key,data) VALUES('strength',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(JSON.stringify(config));
          return json(res, 200, { ok: true });
        }
        if (pathname === "/api/admin/users" && req.method === "GET")
          return json(res, 200, {
            users: db
              .prepare(
                "SELECT id,username,is_admin AS isAdmin,created_at AS createdAt FROM users ORDER BY is_admin DESC,username COLLATE NOCASE",
              )
              .all()
              .map((user) => ({ ...user, isAdmin: Boolean(user.isAdmin) })),
          });
        const userRoute = pathname.match(
          /^\/api\/admin\/users\/(\d+)(?:\/(clear|password))?$/,
        );
        if (userRoute) {
          const targetId = Number(userRoute[1]);
          const target = db
            .prepare("SELECT id,username,is_admin FROM users WHERE id=?")
            .get(targetId);
          if (!target)
            return json(res, 404, {
              error: "No se encontró un usuario administrable.",
            });
          if (userRoute[2] === "clear" && req.method === "POST") {
            db.prepare("DELETE FROM profile WHERE user_id=?").run(targetId);
            db.prepare("DELETE FROM goal WHERE user_id=?").run(targetId);
            for (const table of ["plans", "activities", "proposals"])
              db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(targetId);
            return json(res, 200, { ok: true });
          }
          if (userRoute[2] === "password" && req.method === "POST") {
            const { password } = await bodyJson(req);
            if (
              typeof password !== "string" ||
              password.length < 6 ||
              password.length > 256
            )
              return json(res, 400, {
                error: "La contraseña debe tener al menos 6 caracteres.",
              });
            db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
              await passwordHash(password),
              targetId,
            );
            const currentToken = cookies(req).stride_session;
            for (const [token, active] of sessions)
              if (active.userId === targetId && token !== currentToken)
                sessions.delete(token);
            return json(res, 200, { ok: true });
          }
          if (!userRoute[2] && req.method === "DELETE") {
            if (target.is_admin)
              return json(res, 400, {
                error:
                  "La cuenta administradora está protegida y no se puede eliminar.",
              });
            db.prepare("DELETE FROM users WHERE id=?").run(targetId);
            for (const [token, active] of sessions)
              if (active.userId === targetId) sessions.delete(token);
            return json(res, 200, { ok: true });
          }
        }
        return json(res, 404, {
          error: "Ruta de administración no encontrada.",
        });
      }
      if (pathname === "/api/state" && req.method === "GET")
        return json(res, 200, {
          profile: profile(userId),
          goal: goal(userId),
          plan: latestPlan(userId),
          planVersions: db
            .prepare(
              "SELECT version, created_at AS createdAt FROM plans WHERE user_id=? ORDER BY version DESC",
            )
            .all(userId),
          activities: activities(userId),
          proposal: latestProposal(userId),
        });
      const activityDetailRoute = pathname.match(/^\/api\/activities\/(\d+)$/);
      if (activityDetailRoute && req.method === "GET") {
        const row = db
          .prepare(
            "SELECT id, created_at, data FROM activities WHERE id=? AND user_id=?",
          )
          .get(Number(activityDetailRoute[1]), userId);
        if (!row)
          return json(res, 404, { error: "No se encontró esta actividad." });
        return json(res, 200, {
          id: row.id,
          createdAt: row.created_at,
          ...JSON.parse(row.data),
        });
      }
      if (
        pathname.startsWith("/api/adaptation/") &&
        pathname.endsWith("/dismiss") &&
        req.method === "POST"
      ) {
        const id = Number(pathname.split("/").at(-2));
        db.prepare(
          "UPDATE proposals SET status='dismissed' WHERE id=? AND user_id=? AND status='pending'",
        ).run(id, userId);
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/profile" && req.method === "PUT") {
        const p = await bodyJson(req);
        const scheduleValid =
          Array.isArray(p.trainingSchedule) &&
          p.trainingSchedule.length === 7 &&
          p.trainingSchedule.every(
            (day) =>
              day &&
              typeof day.strength === "boolean" &&
              typeof day.treadmill === "boolean" &&
              typeof day.street === "boolean" &&
              typeof day.longRun === "boolean" &&
              (day.maxSessionMinutes == null || (Number.isFinite(Number(day.maxSessionMinutes)) && Number(day.maxSessionMinutes) >= 15 && Number(day.maxSessionMinutes) <= 300)) &&
              (!day.longRun || day.street),
          );
        const scheduledDays = scheduleValid
          ? p.trainingSchedule.filter(
              (day) => day.strength || day.treadmill || day.street,
            ).length
          : 0;
        if (
          !scheduleValid ||
          scheduledDays < 2 || scheduledDays > 6 ||
          p.trainingSchedule.filter((day) => day.longRun).length > 1
        )
          return json(res, 400, {
            error:
              "Selecciona sesiones en 2–6 días para conservar al menos uno de descanso. La tirada larga solo puede estar marcada en un día con carrera en calle.",
          });
        if (!p.healthScreening || typeof p.healthScreening !== "object" || Object.values(p.healthScreening).some((value) => typeof value !== "boolean") || !p.precautionScreening || typeof p.precautionScreening !== "object" || Object.values(p.precautionScreening).some((value) => typeof value !== "boolean") || typeof p.healthScreeningReviewed !== "boolean")
          return json(res,400,{error:"Completa el cuestionario de seguridad con respuestas válidas."});
        if (
          !Number.isFinite(Number(p.weeklyKm)) ||
          Number(p.weeklyKm) < 0 ||
          Number(p.weeklyKm) > 250
        )
          return json(res, 400, {
            error: "Los kilómetros semanales deben estar entre 0 y 250.",
          });
        for (const [key, min, max] of [
          ["currentWeeklyRuns",0,14],["currentWeeklyMinutes",0,1200],["longestRunMinutes",0,600],
          ["continuousRunMinutes",0,300],["runningExperienceMonths",0,600],["strengthExperienceMonths",0,600],
          ["weeksSinceTraining",0,104],["maxSessionMinutes",15,300],
        ]) {
          if (p[key] !== undefined && (!Number.isFinite(Number(p[key])) || Number(p[key]) < min || Number(p[key]) > max))
            return json(res,400,{error:`El dato ${key} está fuera del rango permitido.`});
        }
        saveSingleton("profile", userId, p);
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/goal" && req.method === "PUT") {
        const g = await bodyJson(req);
        if (!["1", "1.609", "3", "5", "10", "21.1", "21.097", "42.195"].includes(String(g.distanceKm)) || !g.raceDate)
          return json(res, 400, {
            error: "Selecciona una distancia y fecha válidas.",
          });
        if (g.priority && !["finish_healthy","improve_fitness","time_goal"].includes(g.priority))
          return json(res,400,{error:"La prioridad del objetivo no es válida."});
        if (g.terrain && !["road","track","trail","treadmill","mixed"].includes(g.terrain))
          return json(res,400,{error:"El terreno del objetivo no es válido."});
        if (g.elevationGainM !== undefined && g.elevationGainM !== "" && (!Number.isFinite(Number(g.elevationGainM)) || Number(g.elevationGainM)<0 || Number(g.elevationGainM)>5000))
          return json(res,400,{error:"El desnivel debe estar entre 0 y 5000 metros."});
        if (
          g.targetTimeMin &&
          (!Number.isFinite(Number(g.targetTimeMin)) ||
            Number(g.targetTimeMin) < 1 ||
            Number(g.targetTimeMin) > 600)
        )
          return json(res, 400, {
            error: "El tiempo objetivo debe estar entre 10 y 600 minutos.",
          });
        saveSingleton("goal", userId, {
          ...g,
          distanceKm: Number(g.distanceKm) === 21.1 ? 21.097 : Number(g.distanceKm),
          targetTimeMin: g.targetTimeMin ? Number(g.targetTimeMin) : null,
          priority: g.priority || "finish_healthy",
          terrain: g.terrain || "road",
          elevationGainM: g.elevationGainM ? Number(g.elevationGainM) : null,
        });
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/plans/generate" && req.method === "POST") {
        const version = db
          .prepare(
            "SELECT COALESCE(MAX(version),0)+1 AS n FROM plans WHERE user_id=?",
          )
          .get(userId).n;
        const plan = generateHybridPlan(profile(userId), goal(userId), version, strengthConfig(), strengthCatalog, activities(userId));
        db.prepare(
          "INSERT INTO plans(user_id,version,created_at,data) VALUES(?,?,?,?)",
        ).run(userId, version, plan.generatedAt || new Date().toISOString(), JSON.stringify(plan));
        db.prepare(
          "UPDATE proposals SET status='dismissed' WHERE user_id=? AND status='pending'",
        ).run(userId);
        return json(res, 201, { plan });
      }
      if (pathname.startsWith("/api/sessions/") && pathname.endsWith("/fit") && req.method === "POST") {
        const sessionId = pathname.split("/").at(-2);
        const filename = url.searchParams.get("filename") || "session.fit";
        if (!filename.toLowerCase().endsWith(".fit"))
          return json(res, 400, { error: "Adjunta un archivo .FIT para asociarlo a la sesión." });
        const plan = latestPlan(userId);
        if (!plan) return json(res, 404, { error: "No hay un plan activo." });
        const session = plan.sessions.find((item) => item.id === sessionId);
        if (!session) return json(res, 404, { error: "No se encontró la sesión." });
        if (session.status === "skipped") return json(res, 409, { error: "No puedes adjuntar una actividad a una sesión marcada como omitida." });
        const buffer = await bodyBuffer(req, 40 * 1024 * 1024);
        const parsed = await parseActivity(buffer, filename);
        const imported = parsed.activity;
        const existing = db.prepare("SELECT id,data FROM activities WHERE user_id=? AND file_hash=?").get(userId, parsed.fileHash);
        let activityId;
        if (existing) {
          const oldActivity = JSON.parse(existing.data);
          if (oldActivity.sessionId && oldActivity.sessionId !== session.id)
            return json(res, 409, { error: "Este archivo FIT ya está asociado a otra sesión." });
          const saved = {
            ...oldActivity,
            ...imported,
            fileHash: parsed.fileHash,
            filename,
            sessionId: session.id,
            sessionName: session.title,
            planVersion: plan.version,
            note: `Archivo FIT asociado a la sesión: ${session.title}.`,
          };
          db.prepare("UPDATE activities SET data=? WHERE id=? AND user_id=?").run(JSON.stringify(saved), existing.id, userId);
          activityId = Number(existing.id);
        } else {
          const saved = {
            ...imported,
            fileHash: parsed.fileHash,
            filename,
            sessionId: session.id,
            sessionName: session.title,
            planVersion: plan.version,
            rpe: null,
            soreness: "",
            note: `Archivo FIT asociado a la sesión: ${session.title}.`,
          };
          const result = db.prepare("INSERT INTO activities(user_id,file_hash,created_at,data) VALUES(?,?,?,?)").run(userId, parsed.fileHash, new Date().toISOString(), JSON.stringify(saved));
          activityId = Number(result.lastInsertRowid);
        }
        session.activityId = activityId;
        session.activityFileName = filename;
        session.activityDate = imported.date;
        session.updatedAt = new Date().toISOString();
        db.prepare("UPDATE plans SET data=? WHERE version=? AND user_id=?").run(JSON.stringify(plan), plan.version, userId);
        return json(res, 201, { ok: true, activityId, sessionId: session.id });
      }
      if (pathname === "/api/activities/import" && req.method === "POST") {
        const filename = url.searchParams.get("filename") || "activity.fit";
        const buffer = await bodyBuffer(req, 40 * 1024 * 1024);
        const parsed = await parseActivity(buffer, filename);
        const existing = db
          .prepare(
            "SELECT id,data FROM activities WHERE user_id=? AND file_hash=?",
          )
          .get(userId, parsed.fileHash);
        if (existing) {
          const oldActivity = JSON.parse(existing.data);
          const canCompleteOldFit =
            parsed.activity.source === "FIT" &&
            oldActivity.source === "FIT" &&
            !oldActivity.fitData;
          if (!canCompleteOldFit)
            return json(res, 409, {
              error: "Este archivo ya está en tu historial.",
            });
        }
        return json(res, 200, {
          preview: {
            ...parsed.activity,
            filename,
            fileHash: parsed.fileHash,
            ...(existing ? { replacesActivityId: existing.id } : {}),
          },
        });
      }
      if (pathname === "/api/activities" && req.method === "POST") {
        const a = await bodyJson(req, 256 * 1024 * 1024);
        if (
          !a.date ||
          !["run", "strength", "other"].includes(a.type) ||
          (a.rpe !== "" &&
            a.rpe != null &&
            (!Number.isFinite(Number(a.rpe)) ||
              Number(a.rpe) < 1 ||
              Number(a.rpe) > 10))
        )
          return json(res, 400, {
            error: "Revisa la fecha, el tipo y el RPE (1–10).",
          });
        const createdAt = new Date().toISOString();
        const savedData = JSON.stringify({
          ...a,
          rpe: a.rpe === "" || a.rpe == null ? null : Number(a.rpe),
        });
        const existing = a.fileHash
          ? db
              .prepare(
                "SELECT id,data FROM activities WHERE user_id=? AND file_hash=?",
              )
              .get(userId, a.fileHash)
          : null;
        if (existing) {
          const oldActivity = JSON.parse(existing.data);
          const canCompleteOldFit =
            oldActivity.source === "FIT" && a.source === "FIT" && a.fitData;
          if (!canCompleteOldFit || oldActivity.fitData)
            return json(res, 409, {
              error: "Este archivo ya está en tu historial.",
            });
          db.prepare(
            "UPDATE activities SET created_at=?,data=? WHERE id=? AND user_id=?",
          ).run(createdAt, savedData, existing.id, userId);
          return json(res, 200, { id: existing.id, completedImport: true });
        }
        const result = db
          .prepare(
            "INSERT INTO activities(user_id,file_hash,created_at,data) VALUES(?,?,?,?)",
          )
          .run(userId, a.fileHash || null, createdAt, savedData);
        return json(res, 201, { id: Number(result.lastInsertRowid) });
      }
      if (pathname.startsWith("/api/sessions/") && req.method === "PATCH") {
        const sessionId = pathname.split("/").at(-1);
        const payload = await bodyJson(req);
        const { status, readiness } = payload;
        const plan = latestPlan(userId);
        if (!plan) return json(res, 404, { error: "No hay un plan activo." });
        const session = plan.sessions.find((s) => s.id === sessionId);
        if (!session)
          return json(res, 404, { error: "No se encontró la sesión." });
        if (readiness && typeof readiness === "object") {
          const red = ["painWorsening","changesGait","illness","chestPain","dizziness","unusualBreathlessness"].some((key) => readiness[key]);
          const yellow = ["poorSleep","fatigueHigh","stressHigh","muscleSorenessHigh","localizedPain"].some((key) => readiness[key]);
          session.readiness = readiness;
          if (red) {
            session.status = "skipped";
            session.safetyAction = "Sesión cancelada por señales de alarma. No entrenes hoy; si los síntomas son intensos, persisten o empeoran, solicita valoración sanitaria.";
            session.adaptation = "PAUSE_AND_REFER · READINESS-RED-001";
            plan.decisions ||= [];
            plan.decisions.push({ code: "SESSION_CANCELLED_SAFETY", ruleId: "READINESS-RED-001", reason: session.safetyAction, sessionId });
          } else if (yellow) {
            scaleSessionDuration(session, Math.max(10, Math.round(Number(session.durationMin || 30) * 0.75)));
            if (session.type === "run") {
              session.title = session.title.includes("Tirada") ? "Rodaje largo reducido · fácil" : "Rodaje fácil reducido";
              session.category = "EASY_RUN";
              session.effort = "RPE 2–3 · fácil";
              if (session.distanceKm) session.distanceKm = Math.round(session.distanceKm * 0.75 * 10) / 10;
              session.details = "Sesión reducida por preparación amarilla. Mantén conversación fluida, elimina los bloques de calidad y detente si el dolor aumenta.";
            } else {
              session.title = "Fuerza ligera · volumen reducido";
              session.effort = "RIR 4 · ligero, sin dolor";
              session.details = session.details.replace(/(\d+) ×/g, (_, count) => `${Math.max(1, Number(count)-1)} ×`) + " Reduce accesorios y detén cualquier movimiento que cause dolor.";
            }
            session.safetyAction = "Preparación amarilla: carga reducida. Reevalúa durante el calentamiento y cancela si aparece dolor creciente o cambia la técnica.";
            session.adaptation = "DELOAD · READINESS-YELLOW-001";
            plan.decisions ||= [];
            plan.decisions.push({ code: "SESSION_REDUCED_READINESS", ruleId: "READINESS-YELLOW-001", reason: session.safetyAction, sessionId });
          } else {
            session.safetyAction = "Preparación verde: ejecuta la sesión según lo previsto y detente si aparecen síntomas.";
            session.adaptation = "READY · READINESS-GREEN-001";
          }
          session.updatedAt = new Date().toISOString();
          session.readinessAt = new Date().toISOString();
          db.prepare("UPDATE plans SET data=? WHERE version=? AND user_id=?").run(JSON.stringify(plan), plan.version, userId);
          return json(res, 200, { ok: true, status: session.status, safetyAction: session.safetyAction });
        }
        if (!["completed", "skipped", "pending"].includes(status)) return json(res, 400, { error: "Estado de sesión no válido." });
        if (status === "completed" && session.date >= isoDay(new Date()) && (!session.readinessAt || isoDay(new Date(session.readinessAt)) !== isoDay(new Date())))
          return json(res, 400, { error: "Evalúa tu preparación antes de marcar la sesión como completada." });
        session.status = status;
        session.updatedAt = new Date().toISOString();
        db.prepare("UPDATE plans SET data=? WHERE version=? AND user_id=?").run(
          JSON.stringify(plan),
          plan.version,
          userId,
        );
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/adaptation" && req.method === "POST") {
        const history = activities(userId);
        const plan = latestPlan(userId);
        if (!plan) return json(res, 400, { error: "Genera primero un plan para reevaluarlo." });
        const today = new Date(); today.setHours(0,0,0,0);
        const todayKey = isoDay(today);
        const weekStart = new Date(today); weekStart.setDate(today.getDate()-((today.getDay()+6)%7));
        const previousWeekStart = new Date(weekStart); previousWeekStart.setDate(weekStart.getDate()-7);
        const previousWeekKey = isoDay(previousWeekStart);
        const previousWeekEnd = new Date(weekStart); previousWeekEnd.setDate(weekStart.getDate()-1);
        const previousWeekEndKey = isoDay(previousWeekEnd);
        const weekSessions = plan.sessions.filter((s)=>s.date>=previousWeekKey&&s.date<=previousWeekEndKey&&s.type!=="race");
        const completedSessions = weekSessions.filter((s)=>s.status==="completed").length;
        const recent = history.filter((a)=>a.date>=previousWeekKey&&a.date<=previousWeekEndKey);
        const readyChecks=weekSessions.map((s)=>s.readiness||{});
        const painDays = recent.filter((a)=>a.soreness||a.painWorsening||a.painChangesGait).length+readyChecks.filter((r)=>r.localizedPain||r.painWorsening).length;
        const poorRecoveryDays = recent.filter((a)=>a.poorSleep||a.fatigueHigh||Number(a.rpe)>=8).length+readyChecks.filter((r)=>r.poorSleep||r.fatigueHigh||r.stressHigh||r.muscleSorenessHigh).length;
        const illnessDays = recent.filter((a)=>a.illness).length+readyChecks.filter((r)=>r.illness).length;
        const healthProfile=profile(userId);
        const profileRedFlag=Boolean(healthProfile?.painWhileWalking)||Object.values(healthProfile?.healthScreening||{}).some(Boolean);
        const redFlag = profileRedFlag||recent.some((a)=>a.painWorsening||a.painChangesGait||a.illness||a.chestPain||a.dizziness||a.unusualBreathlessness)||readyChecks.some((r)=>r.painWorsening||r.changesGait||r.illness||r.chestPain||r.dizziness||r.unusualBreathlessness)||weekSessions.some((s)=>s.adaptation?.startsWith("PAUSE_AND_REFER"));
        const missedTrainingDays = plan.sessions.filter((s)=>s.status==="skipped"&&s.date>=previousWeekKey&&s.date<=previousWeekEndKey).length;
        const lastCompleted = [...plan.sessions.filter((s)=>s.status==="completed"&&s.type!=="race").map((s)=>s.date),...history.map((a)=>a.date)].sort().at(-1);
        const breakDays = lastCompleted ? Math.floor((today-new Date(`${lastCompleted}T00:00:00`))/86400000) : 0;
        const reviewMissedDays = breakDays>=7?Math.max(missedTrainingDays,4):missedTrainingDays;
        const assessment = assessWeeklyAdaptation({plannedSessions:weekSessions.length,completedSessions,painDays,poorRecoveryDays,illnessDays,missedTrainingDays:reviewMissedDays,redFlag});
        const endDate = new Date(today); endDate.setDate(today.getDate()+7); const endKey=isoDay(endDate);
        const completedRunMinutes=weekSessions.filter((s)=>s.status==="completed"&&s.type==="run").reduce((sum,s)=>sum+Number(s.durationMin||0),0);
        const completedLongestRun=weekSessions.filter((s)=>s.status==="completed"&&s.type==="run"&&(s.category==="LONG_RUN"||s.title.includes("Tirada"))).reduce((max,s)=>Math.max(max,Number(s.durationMin||0)),0);
        const progressionPct=ALGORITHM_CONFIG.maximumWeeklyIncreasePctByLevel[plan.athleteLevel||1]||0;
        const adjusted = plan.sessions.map((session)=>{
          if(session.date<todayKey||session.date>endKey||session.status!=="pending"||session.type==="race") return session;
          if(assessment.state==="PAUSE_AND_REFER") return {...session,status:"skipped",safetyAction:assessment.reason,adaptation:"PAUSE_AND_REFER · ADAPT-PAUSE-001"};
          if(assessment.state==="DELOAD"||assessment.state==="REGRESS") {
            const factor=assessment.state==="DELOAD"?0.8:0.7;
            const next={...session,effort:"RPE 2–3 · fácil y controlado",adaptation:`${assessment.state} · ${assessment.ruleId}`,safetyAction:assessment.reason};
            scaleSessionDuration(next,Math.max(10,Math.round(Number(session.durationMin||30)*factor)));
            if(next.type==="run") { next.title=session.title.includes("Tirada")?"Tirada reducida y fácil":"Rodaje fácil reducido"; next.category="EASY_RUN"; next.details="Sesión reducida según la revisión semanal. No recuperes sesiones perdidas ni acumules carga."; }
            else { next.title="Fuerza ligera · descarga"; next.details=session.details.replace(/(\d+) ×/g,(_,n)=>`${Math.max(1,Number(n)-1)} ×`); }
            return next;
          }
          if(assessment.state==="PROGRESS"&&session.type==="run"&&completedRunMinutes>0) {
            let duration=Math.round(Number(session.durationMin||20)*(1+progressionPct));
            const athleteProfile=profile(userId);
            const sessionDay=new Date(`${session.date}T12:00:00`).getDay();
            const sessionDayIndex=(sessionDay+6)%7;
            const dayLimit=Number(athleteProfile?.trainingSchedule?.[sessionDayIndex]?.maxSessionMinutes||athleteProfile?.maxSessionMinutes||300);
            duration=Math.min(duration,dayLimit);
            if(session.category==="LONG_RUN"&&completedLongestRun>0) duration=Math.min(duration,Math.round(completedLongestRun*(1+progressionPct)));
            const next={...session,adaptation:`PROGRESS · ${assessment.ruleId}`,safetyAction:`Carga ajustada un máximo de ${Math.round(progressionPct*100)}% tras cumplimiento alto y recuperación adecuada.`};
            scaleSessionDuration(next,duration);
            return next;
          }
          return {...session,adaptation:`${assessment.state} · ${assessment.ruleId}`,safetyAction:assessment.reason};
        });
        const rebuildAfterBreak=breakDays>=28&&!redFlag;
        const rebuilt=rebuildAfterBreak?generateHybridPlan(profile(userId),goal(userId),plan.version+1,strengthConfig(),strengthCatalog,history):null;
        const proposalReason=rebuildAfterBreak?"Regreso tras una interrupción de 28 días o más: se reclasifica el nivel y se reconstruye una fase de base.":assessment.reason;
        const completedWeekSessions=weekSessions.filter((s)=>s.status==="completed");
        const plannedLoad=weekSessions.reduce((total,s)=>total+Object.values(s.load||{}).reduce((sum,value)=>sum+Number(value||0),0),0);
        const completedLoad=completedWeekSessions.reduce((total,s)=>total+Object.values(s.load||{}).reduce((sum,value)=>sum+Number(value||0),0),0);
        const proposal = {reason:proposalReason,adaptation:{...assessment,reason:proposalReason},weeklyReview:{plannedSessions:weekSessions.length,completedSessions,painDays,poorRecoveryDays,illnessDays,missedTrainingDays:reviewMissedDays,breakDays,plannedDurationMinutes:weekSessions.reduce((sum,s)=>sum+Number(s.durationMin||0),0),completedDurationMinutes:completedWeekSessions.reduce((sum,s)=>sum+Number(s.durationMin||0),0),plannedLoad,completedLoad,completedRunMinutes,longestRunCompleted:completedWeekSessions.some((s)=>s.category==="LONG_RUN"),qualitySessionCompleted:completedWeekSessions.some((s)=>["THRESHOLD","INTERVALS","HILLS"].includes(s.category)),strengthSessionsCompleted:completedWeekSessions.filter((s)=>s.type==="strength").length,sessionRpeAverage:recent.filter((a)=>Number(a.rpe)>0).length?recent.filter((a)=>Number(a.rpe)>0).reduce((sum,a)=>sum+Number(a.rpe),0)/recent.filter((a)=>Number(a.rpe)>0).length:null},generatedFrom:recent.map((a)=>a.id||a.fileHash||a.date),planVersion:plan.version,plan:rebuilt||{...plan,sessions:adjusted,decisions:[...(plan.decisions||[]),{code:`WEEK_${assessment.state}`,ruleId:assessment.ruleId,reason:proposalReason}]}};
        const result = db
          .prepare(
            "INSERT INTO proposals(user_id,status,created_at,data) VALUES(?,'pending',?,?)",
          )
          .run(userId, new Date().toISOString(), JSON.stringify(proposal));
        return json(res, 201, {
          proposal: { id: Number(result.lastInsertRowid), ...proposal },
        });
      }
      if (
        pathname.startsWith("/api/adaptation/") &&
        pathname.endsWith("/accept") &&
        req.method === "POST"
      ) {
        const id = Number(pathname.split("/").at(-2));
        const proposalRow = db
          .prepare(
            "SELECT * FROM proposals WHERE id=? AND user_id=? AND status='pending'",
          )
          .get(id, userId);
        if (!proposalRow)
          return json(res, 404, {
            error: "La propuesta ya no está disponible.",
          });
        const proposal = JSON.parse(proposalRow.data);
        if (!proposal.plan)
          return json(res, 400, {
            error: "No hay un plan que se pueda actualizar.",
          });
        const latest = latestPlan(userId);
        if (latest?.version !== proposal.planVersion)
          return json(res, 409, {
            error:
              "El plan ha cambiado desde que se creó la propuesta. Genera una nueva reevaluación.",
          });
        const version = db
          .prepare(
            "SELECT COALESCE(MAX(version),0)+1 AS n FROM plans WHERE user_id=?",
          )
          .get(userId).n;
        const revised = {
          ...proposal.plan,
          version,
          createdAt: new Date().toISOString(),
          previousVersion: proposal.planVersion,
          changeReason: proposal.reason,
        };
        db.prepare(
          "INSERT INTO plans(user_id,version,created_at,data) VALUES(?,?,?,?)",
        ).run(userId, version, revised.createdAt, JSON.stringify(revised));
        db.prepare(
          "UPDATE proposals SET status='accepted' WHERE id=? AND user_id=?",
        ).run(id, userId);
        return json(res, 200, { plan: revised });
      }
      if (pathname === "/api/export" && req.method === "GET")
        return json(res, 200, exportData(userId), {
          "Content-Disposition": 'attachment; filename="rompesuelas-copia.json"',
        });
      if (pathname === "/api/import-backup" && req.method === "POST") {
        const backup = await bodyJson(req, 256 * 1024 * 1024);
        if (
          backup.format !== "stride-backup-v1" ||
          !Array.isArray(backup.plans) ||
          !Array.isArray(backup.activities)
        )
          return json(res, 400, {
            error: "La copia no tiene un formato compatible.",
          });
        const tx = db.prepare("BEGIN IMMEDIATE");
        tx.run();
        try {
          saveSingleton("profile", userId, backup.profile || {});
          if (backup.goal) saveSingleton("goal", userId, backup.goal);
          else db.prepare("DELETE FROM goal WHERE user_id=?").run(userId);
          for (const table of ["plans", "activities", "proposals"])
            db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(userId);
          for (const plan of backup.plans)
            db.prepare(
              "INSERT INTO plans(user_id,version,created_at,data) VALUES(?,?,?,?)",
            ).run(
              userId,
              Number(plan.version),
              plan.createdAt || new Date().toISOString(),
              JSON.stringify(plan),
            );
          for (const activity of backup.activities) {
            const { createdAt, ...data } = activity;
            db.prepare(
              "INSERT OR IGNORE INTO activities(user_id,file_hash,created_at,data) VALUES(?,?,?,?)",
            ).run(
              userId,
              data.fileHash || null,
              createdAt || new Date().toISOString(),
              JSON.stringify(data),
            );
          }
          for (const proposal of backup.proposals || []) {
            const { createdAt, status, ...data } = proposal;
            db.prepare(
              "INSERT INTO proposals(user_id,status,created_at,data) VALUES(?,?,?,?)",
            ).run(
              userId,
              status || "accepted",
              createdAt || new Date().toISOString(),
              JSON.stringify(data),
            );
          }
          db.prepare("COMMIT").run();
          return json(res, 200, { ok: true });
        } catch (error) {
          db.prepare("ROLLBACK").run();
          throw error;
        }
      }
      return json(res, 404, { error: "Ruta de API no encontrada." });
    }
    if (req.method === "GET" && existsSync(join(root, "dist", "index.html"))) {
      const requested = pathname === "/" ? "/index.html" : pathname;
      const file = resolve(root, "dist", `.${requested}`);
      if (
        !file.startsWith(resolve(root, "dist") + sep) &&
        file !== resolve(root, "dist", "index.html")
      )
        return json(res, 403, { error: "Ruta no permitida." });
      const target = existsSync(file) ? file : join(root, "dist", "index.html");
      const type =
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ico": "image/x-icon",
        }[extname(target)] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": type,
        "X-Frame-Options": "DENY",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      });
      return createReadStream(target).pipe(res);
    }
    return json(res, 404, { error: "No encontrado." });
  } catch (error) {
    console.error(error);
    const status = error?.status || (error instanceof SyntaxError ? 400 : 500);
    return json(res, status, {
      error:
        status >= 500
          ? "Ha ocurrido un error al guardar los datos. Inténtalo de nuevo."
          : error.message || "No se pudo completar la solicitud.",
      ...(error?.reasonCodes ? { reasonCodes: error.reasonCodes } : {}),
    });
  }
});

server.listen(port, "0.0.0.0", () =>
  console.log(
    `Rompesuelas en http://0.0.0.0:${port} — base de datos en ${join(dataDir, "stride.sqlite")}`,
  ),
);

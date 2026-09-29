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

const scrypt = promisify(scryptCb);
const root = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || join(root, "data"));
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, "stride.sqlite"));
db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS goal (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plans (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY AUTOINCREMENT, file_hash TEXT UNIQUE, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);`);

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
async function bodyBuffer(req, max = 8 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max)
      throw Object.assign(new Error("El archivo supera el límite de 40 MB."), {
        status: 413,
      });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function bodyJson(req) {
  const raw = await bodyBuffer(req, 8 * 1024 * 1024);
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
function sessionFor(req) {
  const token = cookies(req).stride_session;
  const expires = token && sessions.get(token);
  if (!expires || expires < Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
  sessions.set(token, Date.now() + sessionTtl);
  return true;
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
  if (typeof password !== "string" || password.length < 10 || !saved)
    return false;
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
function profile() {
  return rowJson(db.prepare("SELECT data FROM profile WHERE id=1").get());
}
function goal() {
  return rowJson(db.prepare("SELECT data FROM goal WHERE id=1").get());
}
function latestPlan() {
  return rowJson(
    db.prepare("SELECT data FROM plans ORDER BY version DESC LIMIT 1").get(),
  );
}
function latestProposal() {
  const row = db
    .prepare(
      "SELECT id, status, created_at, data FROM proposals WHERE status='pending' ORDER BY id DESC LIMIT 1",
    )
    .get();
  return row
    ? {
        id: row.id,
        status: row.status,
        createdAt: row.created_at,
        ...JSON.parse(row.data),
      }
    : null;
}
function activities() {
  return db
    .prepare(
      "SELECT id, created_at, data FROM activities ORDER BY created_at DESC",
    )
    .all()
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      ...JSON.parse(row.data),
    }));
}
function saveSingleton(table, data) {
  db.prepare(
    `INSERT INTO ${table} (id,data) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
  ).run(JSON.stringify(data));
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
function genPlan(p, g, version) {
  if (!p || !g)
    throw Object.assign(
      new Error("Completa primero el perfil y el objetivo."),
      { status: 400 },
    );
  if (
    !g.raceDate ||
    parseDate(g.raceDate) <= new Date(new Date().toDateString())
  )
    throw Object.assign(new Error("La fecha del objetivo debe ser futura."), {
      status: 400,
    });
  const available = Array.isArray(p.trainingDays)
    ? p.trainingDays.map(Number).filter((x) => x >= 0 && x <= 6)
    : [];
  if (available.length < 2)
    throw Object.assign(
      new Error("Selecciona al menos dos días disponibles para entrenar."),
      { status: 400 },
    );
  const start = mondayOf(new Date());
  const end = parseDate(g.raceDate);
  const weeks = Math.max(
    1,
    Math.min(52, Math.ceil((end - start) / (7 * 86400000))),
  );
  const distance = Number(g.distanceKm || 5);
  const schedule = available.slice().sort((a, b) => a - b);
  const sessions = [];
  for (let week = 0; week < weeks; week++) {
    const progress = weeks <= 1 ? 1 : week / (weeks - 1);
    const phase =
      progress < 0.32
        ? "Base"
        : progress < 0.72
          ? "Desarrollo"
          : progress < 0.91
            ? "Específico"
            : "Descarga";
    const cutback = week > 0 && (week + 1) % 4 === 0 && week !== weeks - 1;
    const weekPhase = cutback ? "Descarga" : phase;
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + week * 7);
    const isRaceWeek = week === weeks - 1;
    const runDays =
      schedule.length >= 5
        ? [
            schedule[0],
            schedule[Math.floor(schedule.length / 2)],
            schedule.at(-1),
          ]
        : schedule.length >= 3
          ? [schedule[0], schedule[Math.floor(schedule.length / 2)]]
          : [schedule[0]];
    const strengthDays =
      schedule.length >= 5
        ? [schedule[1], schedule[schedule.length - 2]]
        : schedule.length >= 4
          ? [schedule[1], schedule.at(-1)]
          : [schedule.at(-1)];
    for (const d of runDays) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + d);
      if (date > end || isoDay(date) === g.raceDate) continue;
      const runIndex = runDays.indexOf(d);
      const longRun = runIndex === runDays.length - 1;
      const base = Math.max(
        2,
        Number(p.weeklyKm || 12) / Math.max(1, runDays.length),
      );
      const factor = isRaceWeek
        ? 0.55
        : cutback
          ? 0.72
          : phase === "Base"
            ? 1 + progress * 0.12
            : phase === "Desarrollo"
              ? 1.12 + progress * 0.16
              : phase === "Específico"
                ? 1.2
                : 0.7;
      const km =
        Math.round(Math.max(2, base * factor * (longRun ? 1.65 : 0.92)) * 10) /
        10;
      const isQuality = !longRun && runDays.length > 1 && week % 2 === 1;
      sessions.push({
        id: `w${week}-r${runIndex}`,
        date: isoDay(date),
        day: days[d],
        week: week + 1,
        phase: weekPhase,
        type: "run",
        title: isRaceWeek
          ? "Rodaje suave"
          : cutback
            ? "Rodaje de descarga"
            : longRun
              ? "Tirada larga"
              : isQuality
                ? "Intervalos controlados"
                : "Rodaje fácil",
        distanceKm: km,
        durationMin: Math.round(km * (isQuality ? 6.5 : 7.1)),
        effort: cutback
          ? "RPE 3–4 · recuperación"
          : isQuality
            ? "RPE 7 · alegre y controlado"
            : "RPE 3–4 · conversación cómoda",
        details: isQuality
          ? `Calentamiento 12 min; ${Math.max(4, Math.round(km / 1.5))} × 2 min a ritmo vivo con 2 min suaves; vuelta a la calma.`
          : `Ritmo cómodo y respiración controlada durante ${km} km. Prioriza terminar con buenas sensaciones.`,
        status: "pending",
      });
    }
    for (const d of strengthDays) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + d);
      if (date > end || isoDay(date) === g.raceDate) continue;
      const fullBody =
        strengthDays.length === 1 || strengthDays.indexOf(d) === 0;
      const hasWeights = p.equipment?.some((item) =>
        ["Gimnasio", "Mancuernas", "Barra y discos", "Kettlebell"].includes(
          item,
        ),
      );
      const hasBands = p.equipment?.includes("Bandas elásticas");
      const exercises = fullBody
        ? hasWeights
          ? [
              "Sentadilla goblet",
              "Peso muerto rumano",
              "Zancada atrás",
              "Elevación de gemelos",
              "Plancha",
            ]
          : [
              "Sentadilla dividida",
              "Puente de glúteo a una pierna",
              "Zancada atrás",
              "Elevación de gemelos",
              "Plancha",
            ]
        : hasWeights
          ? [
              "Peso muerto",
              "Step-up",
              "Hip thrust",
              "Remo con mancuerna",
              "Pallof press",
            ]
          : [
              "Puente de glúteo a una pierna",
              "Step-up",
              "Bisagra a una pierna",
              hasBands ? "Remo con banda" : "Bird dog",
              "Plancha lateral",
            ];
      const sets =
        phase === "Base"
          ? 3
          : phase === "Descarga" || isRaceWeek || cutback
            ? 2
            : 3;
      sessions.push({
        id: `w${week}-s${strengthDays.indexOf(d)}`,
        date: isoDay(date),
        day: days[d],
        week: week + 1,
        phase: weekPhase,
        type: "strength",
        title: fullBody
          ? "Fuerza · cuerpo completo"
          : "Fuerza · posterior y estabilidad",
        durationMin: 45,
        effort:
          weekPhase === "Descarga"
            ? "RPE 5–6 · ligero"
            : "RPE 6–7 · deja 2–3 repeticiones en reserva",
        details: `${exercises.map((exercise) => `${exercise} · ${sets} × ${exercise === "Plancha" || exercise === "Pallof press" ? "30–40 s" : "6–10"}`).join("; ")}. Descansa 90–120 s. Equipo: ${p.equipment?.length ? p.equipment.join(", ") : "peso corporal"}. Evita el fallo muscular.`,
        status: "pending",
      });
    }
    if (isRaceWeek)
      sessions.push({
        id: `w${week}-race`,
        date: g.raceDate,
        day: days[(parseDate(g.raceDate).getDay() + 6) % 7],
        week: week + 1,
        phase: "Competición",
        type: "race",
        title: `${g.distanceKm} km · día del objetivo`,
        distanceKm: distance,
        durationMin: g.targetTimeMin || null,
        effort: "Progresivo · empieza conservador",
        details: `Calentamiento suave. Corre los primeros kilómetros de forma controlada y ajusta el esfuerzo según sensaciones.`,
        status: "pending",
      });
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  const notes = [
    `Progresión gradual según ${Number(p.weeklyKm || 12)} km semanales de referencia; incluye semanas de descarga cada cuatro semanas.`,
    "La intensidad se prescribe con RPE y conversación; revisa la carga si aparece dolor o fatiga persistente.",
    `La fuerza se mantiene lejos del fallo y utiliza el equipo indicado (${p.equipment?.length ? p.equipment.join(", ") : "peso corporal"}).`,
  ];
  if (p.limitations?.trim())
    notes.push(
      `Limitaciones comunicadas: ${p.limitations.trim()}. Revisa las sesiones y evita cualquier ejercicio que cause dolor.`,
    );
  return {
    version,
    createdAt: new Date().toISOString(),
    goal: g,
    sessions,
    weeks,
    notes,
  };
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

function exportData() {
  return {
    format: "stride-backup-v1",
    exportedAt: new Date().toISOString(),
    profile: profile(),
    goal: goal(),
    plans: db
      .prepare(
        "SELECT version, created_at AS createdAt, data FROM plans ORDER BY version",
      )
      .all()
      .map((r) => ({
        version: r.version,
        createdAt: r.createdAt,
        ...JSON.parse(r.data),
      })),
    activities: activities().map(({ id, createdAt, ...rest }) => ({
      ...rest,
      createdAt,
    })),
    proposals: db
      .prepare("SELECT status, created_at AS createdAt, data FROM proposals")
      .all()
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
    if (pathname === "/api/session" && req.method === "GET")
      return json(res, 200, {
        authenticated: sessionFor(req),
        needsSetup: !db
          .prepare("SELECT value FROM settings WHERE key='password_hash'")
          .get(),
      });
    if (pathname === "/api/setup" && req.method === "POST") {
      if (
        db.prepare("SELECT value FROM settings WHERE key='password_hash'").get()
      )
        return json(res, 409, { error: "La contraseña ya está configurada." });
      const { password } = await bodyJson(req);
      if (typeof password !== "string" || password.length < 12)
        return json(res, 400, {
          error: "Usa una contraseña de al menos 12 caracteres.",
        });
      const hash = await passwordHash(password);
      db.prepare(
        "INSERT OR IGNORE INTO settings(key,value) VALUES('password_hash',?)",
      ).run(hash);
      const saved = db
        .prepare("SELECT value FROM settings WHERE key='password_hash'")
        .get();
      if (saved.value !== hash)
        return json(res, 409, {
          error:
            "La contraseña ya fue configurada desde otra sesión. Inicia sesión.",
        });
      const token = randomBytes(32).toString("hex");
      sessions.set(token, Date.now() + sessionTtl);
      return json(
        res,
        200,
        { ok: true },
        { "Set-Cookie": secureCookie(token) },
      );
    }
    if (pathname === "/api/login" && req.method === "POST") {
      const address = req.socket.remoteAddress || "local";
      const failures = loginFailures.get(address);
      if (failures?.blockedUntil > Date.now())
        return json(res, 429, {
          error: "Demasiados intentos. Espera unos minutos y vuelve a probar.",
        });
      const { password } = await bodyJson(req);
      const saved = db
        .prepare("SELECT value FROM settings WHERE key='password_hash'")
        .get();
      if (
        typeof password !== "string" ||
        password.length > 256 ||
        !saved ||
        !(await verifyPassword(password, saved.value))
      ) {
        const count = (failures?.count || 0) + 1;
        loginFailures.set(address, {
          count,
          blockedUntil: count >= 5 ? Date.now() + 15 * 60 * 1000 : 0,
        });
        return json(res, 401, { error: "Contraseña incorrecta." });
      }
      loginFailures.delete(address);
      const token = randomBytes(32).toString("hex");
      sessions.set(token, Date.now() + sessionTtl);
      return json(
        res,
        200,
        { ok: true },
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
      if (!sessionFor(req))
        return json(res, 401, { error: "Inicia sesión para continuar." });
      if (pathname === "/api/state" && req.method === "GET")
        return json(res, 200, {
          profile: profile(),
          goal: goal(),
          plan: latestPlan(),
          planVersions: db
            .prepare(
              "SELECT version, created_at AS createdAt FROM plans ORDER BY version DESC",
            )
            .all(),
          activities: activities(),
          proposal: latestProposal(),
        });
      if (
        pathname.startsWith("/api/adaptation/") &&
        pathname.endsWith("/dismiss") &&
        req.method === "POST"
      ) {
        const id = Number(pathname.split("/").at(-2));
        db.prepare(
          "UPDATE proposals SET status='dismissed' WHERE id=? AND status='pending'",
        ).run(id);
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/profile" && req.method === "PUT") {
        const p = await bodyJson(req);
        if (
          !Array.isArray(p.trainingDays) ||
          p.trainingDays.length < 2 ||
          p.trainingDays.some((x) => !Number.isInteger(x) || x < 0 || x > 6)
        )
          return json(res, 400, {
            error: "Selecciona al menos dos días disponibles.",
          });
        if (
          !Number.isFinite(Number(p.weeklyKm)) ||
          Number(p.weeklyKm) < 0 ||
          Number(p.weeklyKm) > 250
        )
          return json(res, 400, {
            error: "Los kilómetros semanales deben estar entre 0 y 250.",
          });
        saveSingleton("profile", p);
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/goal" && req.method === "PUT") {
        const g = await bodyJson(req);
        if (!["5", "10", "21.1"].includes(String(g.distanceKm)) || !g.raceDate)
          return json(res, 400, {
            error: "Selecciona una distancia y fecha válidas.",
          });
        if (
          g.targetTimeMin &&
          (!Number.isFinite(Number(g.targetTimeMin)) ||
            Number(g.targetTimeMin) < 10 ||
            Number(g.targetTimeMin) > 600)
        )
          return json(res, 400, {
            error: "El tiempo objetivo debe estar entre 10 y 600 minutos.",
          });
        saveSingleton("goal", {
          ...g,
          distanceKm: Number(g.distanceKm),
          targetTimeMin: g.targetTimeMin ? Number(g.targetTimeMin) : null,
        });
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/plans/generate" && req.method === "POST") {
        const version = db
          .prepare("SELECT COALESCE(MAX(version),0)+1 AS n FROM plans")
          .get().n;
        const plan = genPlan(profile(), goal(), version);
        db.prepare(
          "INSERT INTO plans(version,created_at,data) VALUES(?,?,?)",
        ).run(version, plan.createdAt, JSON.stringify(plan));
        db.prepare(
          "UPDATE proposals SET status='dismissed' WHERE status='pending'",
        ).run();
        return json(res, 201, { plan });
      }
      if (pathname === "/api/activities/import" && req.method === "POST") {
        const filename = url.searchParams.get("filename") || "activity.fit";
        const buffer = await bodyBuffer(req, 40 * 1024 * 1024);
        const parsed = await parseActivity(buffer, filename);
        if (
          db
            .prepare("SELECT id FROM activities WHERE file_hash=?")
            .get(parsed.fileHash)
        )
          return json(res, 409, {
            error: "Este archivo ya está en tu historial.",
          });
        return json(res, 200, {
          preview: { ...parsed.activity, filename, fileHash: parsed.fileHash },
        });
      }
      if (pathname === "/api/activities" && req.method === "POST") {
        const a = await bodyJson(req);
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
        const result = db
          .prepare(
            "INSERT INTO activities(file_hash,created_at,data) VALUES(?,?,?)",
          )
          .run(
            a.fileHash || null,
            createdAt,
            JSON.stringify({
              ...a,
              rpe: a.rpe === "" || a.rpe == null ? null : Number(a.rpe),
            }),
          );
        return json(res, 201, { id: Number(result.lastInsertRowid) });
      }
      if (pathname.startsWith("/api/sessions/") && req.method === "PATCH") {
        const sessionId = pathname.split("/").at(-1);
        const { status } = await bodyJson(req);
        if (!["completed", "skipped", "pending"].includes(status))
          return json(res, 400, { error: "Estado de sesión no válido." });
        const plan = latestPlan();
        if (!plan) return json(res, 404, { error: "No hay un plan activo." });
        const session = plan.sessions.find((s) => s.id === sessionId);
        if (!session)
          return json(res, 404, { error: "No se encontró la sesión." });
        session.status = status;
        session.updatedAt = new Date().toISOString();
        db.prepare("UPDATE plans SET data=? WHERE version=?").run(
          JSON.stringify(plan),
          plan.version,
        );
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/adaptation" && req.method === "POST") {
        const history = activities();
        if (!history.length)
          return json(res, 400, {
            error:
              "Registra o importa una actividad antes de reevaluar el plan.",
          });
        const recent = history.slice(0, 7);
        const highEffort = recent.some((a) => Number(a.rpe) >= 9);
        const soreness = recent.some((a) => Boolean(a.soreness));
        const skipped =
          latestPlan()?.sessions.filter(
            (s) =>
              s.status === "skipped" &&
              s.date >= new Date().toISOString().slice(0, 10),
          ).length || 0;
        const message =
          highEffort || soreness
            ? "La carga reciente parece alta. Se propone reducir un 20% el volumen de carrera de los próximos 7 días y mantener la fuerza ligera."
            : skipped
              ? "Hay sesiones futuras marcadas como omitidas. Se propone reorganizar la semana y priorizar recuperación."
              : "El esfuerzo registrado es compatible con el plan actual. Se mantiene la progresión prevista y se revisa de nuevo tras las próximas sesiones.";
        const plan = latestPlan();
        const proposedSessions = plan
          ? plan.sessions.map((s) => {
              if (
                s.date < new Date().toISOString().slice(0, 10) ||
                s.date >
                  new Date(Date.now() + 7 * 86400000)
                    .toISOString()
                    .slice(0, 10) ||
                s.status !== "pending" ||
                s.type === "race"
              )
                return s;
              if (highEffort || soreness)
                return s.type === "run"
                  ? {
                      ...s,
                      distanceKm: Math.round(s.distanceKm * 0.8 * 10) / 10,
                      durationMin: Math.round(s.durationMin * 0.8),
                      effort: "RPE 3 · recuperación",
                      title: s.title.includes("Tirada")
                        ? "Rodaje largo reducido"
                        : "Rodaje fácil reducido",
                      adaptation:
                        "Volumen reducido un 20% por el esfuerzo o las molestias comunicadas.",
                    }
                  : {
                      ...s,
                      durationMin: 30,
                      effort: "RPE 5 · ligero, sin dolor",
                      details: `${s.details.replaceAll(/([2-3]) ×/g, (_, sets) => `${Math.max(1, Number(sets) - 1)} ×`)} Reduce una serie por ejercicio y detén cualquier movimiento que provoque dolor.`,
                      adaptation:
                        "Fuerza ligera y una serie menos por ejercicio según el esfuerzo o las molestias comunicadas.",
                    };
              if (skipped && s.type === "run")
                return {
                  ...s,
                  title: "Rodaje fácil · semana reajustada",
                  effort: "RPE 3–4 · conversación cómoda",
                  adaptation: "Sesión reajustada para recuperar continuidad.",
                };
              return s;
            })
          : [];
        const proposal = {
          reason: message,
          generatedFrom: recent.map((a) => a.id || a.fileHash || a.date),
          planVersion: plan?.version ?? null,
          plan: plan ? { ...plan, sessions: proposedSessions } : null,
        };
        const result = db
          .prepare(
            "INSERT INTO proposals(status,created_at,data) VALUES('pending',?,?)",
          )
          .run(new Date().toISOString(), JSON.stringify(proposal));
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
          .prepare("SELECT * FROM proposals WHERE id=? AND status='pending'")
          .get(id);
        if (!proposalRow)
          return json(res, 404, {
            error: "La propuesta ya no está disponible.",
          });
        const proposal = JSON.parse(proposalRow.data);
        if (!proposal.plan)
          return json(res, 400, {
            error: "No hay un plan que se pueda actualizar.",
          });
        const latest = latestPlan();
        if (latest?.version !== proposal.planVersion)
          return json(res, 409, {
            error:
              "El plan ha cambiado desde que se creó la propuesta. Genera una nueva reevaluación.",
          });
        const version = db
          .prepare("SELECT COALESCE(MAX(version),0)+1 AS n FROM plans")
          .get().n;
        const revised = {
          ...proposal.plan,
          version,
          createdAt: new Date().toISOString(),
          previousVersion: proposal.planVersion,
          changeReason: proposal.reason,
        };
        db.prepare(
          "INSERT INTO plans(version,created_at,data) VALUES(?,?,?)",
        ).run(version, revised.createdAt, JSON.stringify(revised));
        db.prepare("UPDATE proposals SET status='accepted' WHERE id=?").run(id);
        return json(res, 200, { plan: revised });
      }
      if (pathname === "/api/export" && req.method === "GET")
        return json(res, 200, exportData(), {
          "Content-Disposition": 'attachment; filename="stride-backup.json"',
        });
      if (pathname === "/api/import-backup" && req.method === "POST") {
        const backup = await bodyJson(req);
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
          saveSingleton("profile", backup.profile || {});
          if (backup.goal) saveSingleton("goal", backup.goal);
          else db.prepare("DELETE FROM goal WHERE id=1").run();
          db.exec(
            "DELETE FROM plans; DELETE FROM activities; DELETE FROM proposals;",
          );
          for (const plan of backup.plans)
            db.prepare(
              "INSERT INTO plans(version,created_at,data) VALUES(?,?,?)",
            ).run(
              Number(plan.version),
              plan.createdAt || new Date().toISOString(),
              JSON.stringify(plan),
            );
          for (const activity of backup.activities) {
            const { createdAt, ...data } = activity;
            db.prepare(
              "INSERT OR IGNORE INTO activities(file_hash,created_at,data) VALUES(?,?,?)",
            ).run(
              data.fileHash || null,
              createdAt || new Date().toISOString(),
              JSON.stringify(data),
            );
          }
          for (const proposal of backup.proposals || []) {
            const { createdAt, status, ...data } = proposal;
            db.prepare(
              "INSERT INTO proposals(status,created_at,data) VALUES(?,?,?)",
            ).run(
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
    });
  }
});

server.listen(port, "0.0.0.0", () =>
  console.log(
    `Stride API en http://0.0.0.0:${port} — base de datos en ${join(dataDir, "stride.sqlite")}`,
  ),
);

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
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { XMLParser } from "fast-xml-parser";
import FitParser from "fit-file-parser";
import nodemailer from "nodemailer";
import { generateHybridPlan, assessWeeklyAdaptation, refreshRunSessionPrescription, ALGORITHM_CONFIG } from "./algorithm.mjs";

const scrypt = promisify(scryptCb);
const root = dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(join(root, ".env")); }
catch (error) { if (error?.code !== "ENOENT") throw error; }
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
const garminOperations = new Map();
const garminTokenDir = (userId) => join(dataDir, "garmin", String(userId));
const garminTokenFile = (userId) => join(garminTokenDir(userId), "garmin_tokens.json");
function isLocalBrowser(req) {
  const origin = req.headers.origin;
  const hostHeader = origin || req.headers.host || "";
  try {
    const hostname = new URL(hostHeader.includes("://") ? hostHeader : `http://${hostHeader}`).hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}
function isValidGarminRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "") || from > to) return false;
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.toISOString().slice(0, 10) !== from || end.toISOString().slice(0, 10) !== to) return false;
  return (end.getTime() - start.getTime()) / 86400000 <= 365;
}
const weeklyEmailRecipient = "mgcm2812@gmail.com";
function smtpSettings() {
  const port = Number(process.env.SMTP_PORT || 465);
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE.toLowerCase() === "true" : port === 465,
    user: process.env.SMTP_USER || "",
    pass: (process.env.SMTP_PASS || "").replace(/\s/g, ""),
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  };
}
function currentWeekRange() {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { from: key(monday), to: key(sunday) };
}
function emailEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function weeklyPlanEmail(plan, sessions, range) {
  const fmtDate = (date) => new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const duration = (minutes) => {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    return hours ? `${hours} h${total % 60 ? ` ${total % 60} min` : ""}` : `${total} min`;
  };
  const distance = (km) => km == null ? "—" : `${Number(km).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km`;
  const statusLabel = (status) => status === "completed" ? "Completada" : status === "skipped" ? "Omitida" : "Pendiente";
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${range.from}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  const cards = days.map((date) => {
    const items = sessions.filter((session) => session.date === date);
    const dateHeading = fmtDate(date);
    if (!items.length) return { date, text: `${dateHeading}\nDescanso.`, html: `<tr><td style="padding:15px 16px;border-bottom:1px solid #edf1ec"><strong style="text-transform:capitalize">${emailEscape(dateHeading)}</strong><p style="margin:5px 0 0;color:#738078">Descanso</p></td></tr>` };
    const text = items.map((session) => {
      const environment = session.environment === "treadmill" ? "Cinta" : session.environment === "outdoor" ? "Exterior" : session.environmentOptions?.length ? session.environmentOptions.map((item) => item === "treadmill" ? "Cinta" : "Calle").join(" o ") : "";
      const kind = session.type === "strength" ? "Fuerza" : session.type === "race" ? "Competición" : session.type === "recovery" ? "Recuperación" : "Carrera";
      const stats = [`Duración: ${duration(session.durationMin)}`, `Distancia: ${distance(session.distanceKm)}`, `Esfuerzo: ${session.effort || "—"}`, `Estado: ${statusLabel(session.status)}`].join(" · ");
      const exercises = (session.strengthExercises || []).map((exercise) => `  • ${exercise.name}: ${exercise.sets} × ${exercise.reps} · RIR ${exercise.rir} · descanso ${exercise.restSec} s`).join("\n");
      return `${session.title}\n${kind}${environment ? ` · ${environment}` : ""} · ${stats}\n${session.details || ""}${exercises ? `\nEjercicios:\n${exercises}` : ""}`;
    }).join("\n\n");
    const htmlSessions = items.map((session) => {
      const environment = session.environment === "treadmill" ? " · Cinta" : session.environment === "outdoor" ? " · Exterior" : session.environmentOptions?.length ? ` · ${session.environmentOptions.map((item) => item === "treadmill" ? "Cinta" : "Calle").join(" o ")}` : "";
      const kind = session.type === "strength" ? "Fuerza" : session.type === "race" ? "Competición" : session.type === "recovery" ? "Recuperación" : "Carrera";
      const exercises = (session.strengthExercises || []).length ? `<ul style="padding-left:20px;margin:8px 0">${session.strengthExercises.map((exercise) => `<li style="margin:4px 0">${emailEscape(exercise.name)} · ${emailEscape(exercise.sets)} × ${emailEscape(exercise.reps)} · RIR ${emailEscape(exercise.rir)} · descanso ${emailEscape(exercise.restSec)} s</li>`).join("")}</ul>` : "";
      return `<div style="padding:12px 0;border-top:1px solid #edf1ec"><strong>${emailEscape(session.title)}</strong><div style="margin:5px 0;color:#55735f;font-size:13px">${kind}${environment} · ${emailEscape(duration(session.durationMin))} · ${emailEscape(distance(session.distanceKm))} · ${emailEscape(statusLabel(session.status))}</div>${session.effort ? `<p style="margin:5px 0;font-size:13px"><b>Esfuerzo:</b> ${emailEscape(session.effort)}</p>` : ""}<p style="margin:6px 0;line-height:1.55;white-space:pre-line">${emailEscape(session.details || "")}</p>${exercises}</div>`;
    }).join("");
    return { date, text: `${dateHeading}\n${text}`, html: `<tr><td style="padding:15px 16px;border-bottom:1px solid #edf1ec"><strong style="text-transform:capitalize">${emailEscape(dateHeading)}</strong>${htmlSessions}</td></tr>` };
  });
  const formattedRange = `${new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${range.from}T12:00:00Z`))} – ${new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${range.to}T12:00:00Z`))}`;
  const subject = `Tu plan de entrenamiento · ${formattedRange}`;
  const text = `Tu semana de entrenamiento\n${formattedRange}\nPlan v${plan.version}\n\n${cards.map((day) => day.text).join("\n\n────────────────────────\n\n")}\n\nEnviado desde Rompesuelas.`;
  const html = `<div style="background:#f5f7f2;padding:24px 12px;font-family:Arial,sans-serif;color:#26372c"><div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e4ebe2;border-radius:16px;overflow:hidden"><div style="padding:22px 20px;background:linear-gradient(120deg,#e8f2e8,#f8f5e9)"><div style="font-size:11px;letter-spacing:1.5px;color:#597360">ROMPESUELAS · PLAN SEMANAL</div><h1 style="font-size:23px;margin:8px 0 4px">Tu entrenamiento de esta semana</h1><div style="color:#61736a">${emailEscape(formattedRange)} · Plan v${emailEscape(plan.version)}</div></div><table role="presentation" style="width:100%;border-collapse:collapse">${cards.map((day) => day.html).join("")}</table><div style="padding:14px 16px;color:#809087;font-size:12px">Enviado desde Rompesuelas.</div></div></div>`;
  return { subject, text, html };
}
function garminBridge(args, input) {
  const python = process.env.GARMIN_PYTHON || "python";
  const child = spawn(python, [join(root, "garmin_bridge.py"), ...args], {
    cwd: root,
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  child.on("error", () => {});
  child.stdin.end(JSON.stringify(input));
  return child;
}

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
function reduceStrengthSession(session, suffix = "") {
  session.title = "Fuerza ligera · volumen reducido";
  session.effort = "RIR 4 · ligero, sin fallo";
  if (Array.isArray(session.strengthExercises)) {
    session.strengthExercises = session.strengthExercises.map((exercise) => ({ ...exercise, sets: Math.max(1, Number(exercise.sets || 1) - 1), rir: 4 }));
    const prescription = session.strengthExercises.map((exercise) => `${exercise.name} (${exercise.pattern}) · ${exercise.sets} × ${exercise.reps} · RIR ${exercise.rir}`).join("; ");
    const warmupAt = session.details.indexOf(". Calentamiento:");
    const instructions = warmupAt >= 0 ? session.details.slice(warmupAt) : ". Calentamiento suave, técnica controlada y sin dolor.";
    session.details = `${prescription}${instructions}${suffix}`;
  } else {
    session.details = session.details.replace(/(\d+) ×/g, (_, count) => `${Math.max(1, Number(count) - 1)} ×`) + suffix;
  }
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
      if (!includeFitData) { delete activity.fitData; delete activity.garminSummary; }
      // Keep the database key authoritative. Garmin's external activity ID is
      // stored separately as garminActivityId.
      return { ...activity, id: Number(row.id), createdAt: row.created_at };
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
  divisions: ["Torso/Pierna", "Empuje/Tirón/Pierna", "Cuerpo completo"],
  groups: {
    "Pierna y cadera": [
      { name: "Sentadilla goblet", pattern: "Rodilla bilateral", equipment: ["Mancuernas"], role: "base", complexity: "básica" },
      { name: "Sentadilla con barra", pattern: "Rodilla bilateral", equipment: ["Barra", "Rack"], role: "base", complexity: "técnica" },
      { name: "Prensa de piernas", pattern: "Rodilla bilateral", equipment: ["Máquina de gimnasio"], role: "base", complexity: "básica" },
      { name: "Sentadilla en multipower", pattern: "Rodilla bilateral", equipment: ["Máquina Smith"], role: "alternativa", complexity: "básica" },
      { name: "Split squat", pattern: "Rodilla unilateral", equipment: ["Peso corporal", "Mancuernas"], role: "base", complexity: "básica" },
      { name: "Zancada hacia atrás", pattern: "Rodilla unilateral", equipment: ["Peso corporal", "Mancuernas"], role: "base", complexity: "básica" },
      { name: "Step-up bajo", pattern: "Rodilla unilateral", equipment: ["Banco/cajón"], role: "base", complexity: "básica" },
      { name: "Prensa unilateral", pattern: "Rodilla unilateral", equipment: ["Máquina de gimnasio"], role: "alternativa", complexity: "básica" },
      { name: "Peso muerto rumano con mancuernas", pattern: "Bisagra de cadera", equipment: ["Mancuernas"], role: "base", complexity: "básica" },
      { name: "Peso muerto rumano con barra", pattern: "Bisagra de cadera", equipment: ["Barra"], role: "base", complexity: "técnica" },
      { name: "Pull-through en polea", pattern: "Bisagra de cadera", equipment: ["Polea"], role: "alternativa", complexity: "básica" },
      { name: "Extensión de cadera en banco", pattern: "Bisagra de cadera", equipment: ["Banco romano"], role: "alternativa", complexity: "básica" },
      { name: "Hip thrust con barra", pattern: "Extensión de cadera", equipment: ["Barra", "Banco"], role: "base", complexity: "básica" },
      { name: "Hip thrust en máquina", pattern: "Extensión de cadera", equipment: ["Máquina de gimnasio"], role: "alternativa", complexity: "básica" },
      { name: "Puente de glúteos", pattern: "Extensión de cadera", equipment: ["Peso corporal"], role: "alternativa", complexity: "básica" },
      { name: "Curl femoral sentado", pattern: "Flexión de rodilla", equipment: ["Máquina de gimnasio"], role: "base", complexity: "básica" },
      { name: "Curl femoral tumbado", pattern: "Flexión de rodilla", equipment: ["Máquina de gimnasio"], role: "alternativa", complexity: "básica" },
      { name: "Extensión de cuádriceps en máquina", pattern: "Extensión de rodilla", equipment: ["Máquina de gimnasio"], role: "opcional", complexity: "básica" },
      { name: "Abducción de cadera en máquina", pattern: "Abducción de cadera", equipment: ["Máquina de gimnasio"], role: "opcional", complexity: "básica" },
      { name: "Aducción de cadera en máquina", pattern: "Aducción de cadera", equipment: ["Máquina de gimnasio"], role: "opcional", complexity: "básica" },
      { name: "Elevación de gemelos de pie", pattern: "Flexión plantar de tobillo", equipment: ["Peso corporal", "Mancuernas"], role: "base", complexity: "básica" },
      { name: "Gemelo sentado en máquina", pattern: "Flexión plantar de tobillo", equipment: ["Máquina de gimnasio"], role: "alternativa", complexity: "básica" },
      { name: "Gemelo sentado con mancuerna", pattern: "Flexión plantar de tobillo", equipment: ["Mancuernas", "Banco"], role: "alternativa", complexity: "básica" },
      { name: "Gemelo en prensa", pattern: "Flexión plantar de tobillo", equipment: ["Prensa de piernas"], role: "alternativa", complexity: "básica" },
      { name: "Tibialis raise", pattern: "Dorsiflexión de tobillo", equipment: ["Peso corporal"], role: "opcional", complexity: "básica" },
      { name: "Dorsiflexión con banda", pattern: "Dorsiflexión de tobillo", equipment: ["Banda elástica"], role: "opcional", complexity: "básica" },
    ],
    Torso: [
      { name: "Press de pecho en máquina", pattern: "Empuje horizontal", equipment: ["Máquina de gimnasio"], role: "base", complexity: "básica" },
      { name: "Press banca con mancuernas", pattern: "Empuje horizontal", equipment: ["Mancuernas", "Banco"], role: "base", complexity: "básica" },
      { name: "Press banca con barra", pattern: "Empuje horizontal", equipment: ["Barra", "Banco"], role: "alternativa", complexity: "técnica" },
      { name: "Press inclinado con mancuernas", pattern: "Empuje inclinado", equipment: ["Mancuernas", "Banco inclinado"], role: "base", complexity: "básica" },
      { name: "Press inclinado en máquina", pattern: "Empuje inclinado", equipment: ["Máquina de gimnasio"], role: "base", complexity: "básica" },
      { name: "Flexión inclinada", pattern: "Empuje inclinado", equipment: ["Banco/cajón"], role: "alternativa", complexity: "básica" },
      { name: "Press hombro con mancuernas", pattern: "Empuje vertical", equipment: ["Mancuernas"], role: "opcional", complexity: "básica" },
      { name: "Press hombro en máquina", pattern: "Empuje vertical", equipment: ["Máquina de gimnasio"], role: "opcional", complexity: "básica" },
      { name: "Jalón al pecho", pattern: "Tirón vertical", equipment: ["Polea"], role: "base", complexity: "básica" },
      { name: "Dominada asistida", pattern: "Tirón vertical", equipment: ["Máquina asistida"], role: "alternativa", complexity: "básica" },
      { name: "Dominada libre", pattern: "Tirón vertical", equipment: ["Barra de dominadas"], role: "alternativa", complexity: "técnica" },
      { name: "Remo sentado en polea", pattern: "Tirón horizontal", equipment: ["Polea"], role: "base", complexity: "básica" },
      { name: "Remo con pecho apoyado en máquina", pattern: "Tirón horizontal", equipment: ["Máquina de gimnasio"], role: "base", complexity: "básica" },
      { name: "Remo con pecho apoyado con mancuernas", pattern: "Tirón horizontal", equipment: ["Banco inclinado", "Mancuernas"], role: "base", complexity: "básica" },
      { name: "Remo con mancuerna apoyado", pattern: "Tirón horizontal", equipment: ["Mancuerna", "Banco"], role: "alternativa", complexity: "básica" },
      { name: "Remo con banda elástica", pattern: "Tirón horizontal", equipment: ["Banda elástica"], role: "alternativa", complexity: "básica" },
      { name: "Elevación lateral", pattern: "Deltoides lateral", equipment: ["Mancuernas"], role: "opcional", complexity: "básica" },
      { name: "Pájaro en máquina", pattern: "Deltoides posterior", equipment: ["Máquina de gimnasio"], role: "opcional", complexity: "básica" },
      { name: "Pájaro en polea", pattern: "Deltoides posterior", equipment: ["Polea"], role: "opcional", complexity: "básica" },
      { name: "Curl de bíceps con mancuerna", pattern: "Flexión de codo", equipment: ["Mancuernas"], role: "opcional", complexity: "básica" },
      { name: "Curl de bíceps en polea", pattern: "Flexión de codo", equipment: ["Polea"], role: "opcional", complexity: "básica" },
      { name: "Curl con barra EZ", pattern: "Flexión de codo", equipment: ["Barra EZ"], role: "opcional", complexity: "básica" },
      { name: "Extensión de tríceps en polea", pattern: "Extensión de codo", equipment: ["Polea"], role: "opcional", complexity: "básica" },
      { name: "Extensión de tríceps sobre cabeza en polea", pattern: "Extensión de codo", equipment: ["Polea"], role: "opcional", complexity: "básica" },
    ],
    Tronco: [
      { name: "Plancha", pattern: "Estabilidad anterior", equipment: ["Peso corporal"], role: "opcional", complexity: "básica" },
      { name: "Dead bug", pattern: "Estabilidad anterior", equipment: ["Peso corporal"], role: "opcional", complexity: "básica" },
      { name: "Pallof press", pattern: "Antirrotación", equipment: ["Polea", "Banda elástica"], role: "opcional", complexity: "básica" },
      { name: "Crunch controlado", pattern: "Flexión de tronco", equipment: ["Peso corporal"], role: "opcional", complexity: "básica" },
    ],
  },
};
const defaultStrengthConfig = { division: "Cuerpo completo", exercises: Object.values(strengthCatalog.groups).flat().map((exercise) => exercise.name) };
const legacyStrengthExerciseNames = {
  "Dominadas": "Dominada asistida", "Jalón": "Jalón al pecho", "Remo en máquina": "Remo sentado en polea", "Remo gironda": "Remo sentado en polea",
  "Press en máquina inclinado": "Press inclinado en máquina", "Press en máquina": "Press de pecho en máquina", "Press con mancuernas": "Press banca con mancuernas",
  "Fondos paralelas": "Press banca con mancuernas", "Aperturas": "Press inclinado con mancuernas", "Press militar máquina": "Press hombro en máquina", "Press militar mancuernas": "Press hombro con mancuernas",
  "Elevaciones laterales mancuernas": "Elevación lateral", "Pájaros en máquina": "Pájaro en máquina", "Curl bíceps mancuerna": "Curl de bíceps con mancuerna", "Extensión tríceps polea": "Extensión de tríceps en polea",
  "Curl bíceps barra": "Curl con barra EZ", "Press tríceps barra": "Extensión de tríceps sobre cabeza en polea", "Prensa": "Prensa de piernas", "Sentadilla multipower": "Sentadilla en multipower", "Hip Thrust": "Hip thrust con barra",
  "Prensa horizontal": "Prensa de piernas", "Extensiones cuádriceps": "Extensión de cuádriceps en máquina", "Curl femoral tumbado": "Curl femoral tumbado", "Curl femoral sentado": "Curl femoral sentado", "Abductor": "Abducción de cadera en máquina", "Adductor": "Aducción de cadera en máquina", "Gemelo en máquina": "Elevación de gemelos de pie",
  "Planchas": "Plancha", "Crunch abdominal": "Crunch controlado", "Press Pallof": "Pallof press",
};
function normalizedStrengthConfig(config = strengthConfig()) {
  const names = new Set(Object.values(strengthCatalog.groups).flat().map((exercise) => exercise.name));
  const migrationDecisions = [];
  const exercises = [...new Set((config.exercises || []).map((name) => {
    const mapped = legacyStrengthExerciseNames[name] || name;
    if (mapped !== name) migrationDecisions.push({ code: "STRENGTH_LEGACY_EXERCISE_MAPPED", ruleId: "STRENGTH-MIGRATION-001", reason: `${name} se normaliza a ${mapped} para nuevos planes.` });
    else if (!names.has(name)) migrationDecisions.push({ code: "STRENGTH_LEGACY_EXERCISE_UNAVAILABLE", ruleId: "STRENGTH-MIGRATION-002", reason: `${name} no tiene equivalencia directa en el catálogo actual y no se incluye en nuevos planes.` });
    return mapped;
  }).filter((name) => names.has(name)))];
  const division = ({ FullBody: "Cuerpo completo", "Tirón/Empuje/Pierna": "Empuje/Tirón/Pierna" })[config.division] || config.division;
  if (division !== config.division) migrationDecisions.push({ code: "STRENGTH_LEGACY_DIVISION_MAPPED", ruleId: "STRENGTH-MIGRATION-001", reason: `La división ${config.division} se normaliza a ${division} para planes nuevos.` });
  return { ...config, division: strengthCatalog.divisions.includes(division) ? division : defaultStrengthConfig.division, exercises: exercises.length ? exercises : defaultStrengthConfig.exercises, migrationDecisions };
}
function strengthConfig() {
  const row = db.prepare("SELECT data FROM app_settings WHERE key='strength'").get();
  return normalizedStrengthConfig(row ? JSON.parse(row.data) : defaultStrengthConfig);
}
const defaultAiConfig = { enabled: false, apiKey: "", model: "gpt-4.1-mini", temperature: 0.3, topP: 1, maxCompletionTokens: 4000, timeoutSeconds: 60, jsonMode: true };
function aiConfig() {
  const row = db.prepare("SELECT data FROM app_settings WHERE key='ai'").get();
  return row ? { ...defaultAiConfig, ...JSON.parse(row.data) } : defaultAiConfig;
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
    const durationSeconds =
      validTimes.length > 1
        ? Math.round((Math.max(...validTimes) - Math.min(...validTimes)) / 1000)
        : null;
    data = {
      source: "GPX",
      date: validTimes.length
        ? new Date(Math.min(...validTimes)).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      type: "run",
      distanceKm: Math.round(km * 100) / 100,
      durationSeconds,
      durationMin: durationSeconds !== null ? durationSeconds / 60 : null,
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
    const durationSeconds = Math.round(
      Number(session.total_elapsed_time || session.total_timer_time || 0),
    );
    data = {
      source: "FIT",
      date: Number.isNaN(startTime.getTime())
        ? new Date().toISOString().slice(0, 10)
        : startTime.toISOString().slice(0, 10),
      type,
      distanceKm: Number(session.total_distance) || null,
      durationSeconds: durationSeconds || null,
      durationMin: durationSeconds ? durationSeconds / 60 : null,
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
      if (pathname === "/api/email/week/status" && req.method === "GET") {
        const smtp = smtpSettings();
        const missing = [!smtp.user && "SMTP_USER", !smtp.pass && "SMTP_PASS"].filter(Boolean);
        const gmailPasswordIssue = /smtp\.gmail\.com/i.test(smtp.host) && Boolean(smtp.pass) && smtp.pass.length !== 16;
        return json(res, 200, { configured: missing.length === 0 && !gmailPasswordIssue, missing, issue: gmailPasswordIssue ? "gmail_app_password_length" : null, recipient: weeklyEmailRecipient, range: currentWeekRange() });
      }
      if (pathname === "/api/email/week/send" && req.method === "POST") {
        const smtp = smtpSettings();
        if (!smtp.user || !smtp.pass)
          return json(res, 503, { error: "Configura SMTP_USER y SMTP_PASS en el archivo .env local y reinicia la aplicación." });
        if (/smtp\.gmail\.com/i.test(smtp.host) && smtp.pass.length !== 16)
          return json(res, 503, { error: "SMTP_PASS debe ser la contraseña de aplicación de Gmail de 16 caracteres, no la contraseña habitual de la cuenta. Revisa .env y reinicia la aplicación." });
        if (!Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535 || !smtp.from)
          return json(res, 503, { error: "La configuración SMTP local no es válida. Revisa SMTP_HOST, SMTP_PORT y SMTP_FROM." });
        const plan = latestPlan(userId);
        if (!plan) return json(res, 404, { error: "Todavía no hay un plan de entrenamiento para enviar." });
        const range = currentWeekRange();
        const weeklySessions = plan.sessions.filter((item) => item.date >= range.from && item.date <= range.to).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
        if (!weeklySessions.length)
          return json(res, 409, { error: "El plan activo no contiene sesiones programadas para la semana en curso." });
        const message = weeklyPlanEmail(plan, weeklySessions, range);
        const transporter = nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          auth: { user: smtp.user, pass: smtp.pass },
          connectionTimeout: 15000,
          greetingTimeout: 15000,
          socketTimeout: 30000,
          tls: { rejectUnauthorized: true },
        });
        try {
          await transporter.sendMail({ from: smtp.from, to: weeklyEmailRecipient, subject: message.subject, text: message.text, html: message.html });
        } catch (error) {
          const code = String(error?.code || "");
          const responseCode = Number(error?.responseCode || 0);
          console.error("No se pudo enviar el correo semanal por SMTP:", code || responseCode || "error desconocido");
          const message = code === "EAUTH" || responseCode === 534 || responseCode === 535
            ? "Gmail rechazó el acceso SMTP. Comprueba que SMTP_PASS sea una contraseña de aplicación vigente de 16 caracteres y que SMTP_USER sea la cuenta que la generó."
            : code === "ETLS" || code === "ESOCKET" && /tls|certificate/i.test(String(error?.message || ""))
              ? "Falló la conexión TLS con el servidor SMTP. Comprueba SMTP_PORT y SMTP_SECURE (Gmail usa normalmente puerto 465 con SMTP_SECURE=true)."
              : ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS"].includes(code)
                ? "No se pudo conectar con el servidor SMTP. Comprueba la conexión a Internet, el servidor y el puerto; algunas redes bloquean SMTP."
                : "No se pudo enviar el correo. Revisa la configuración SMTP y que la dirección remitente esté autorizada por el servidor.";
          return json(res, 502, { error: message });
        } finally { transporter.close(); }
        return json(res, 200, { ok: true, recipient: weeklyEmailRecipient, range, sessions: weeklySessions.length });
      }
      if (pathname.startsWith("/api/garmin") || pathname.startsWith("/api/activities/garmin")) {
        if (!isLocalBrowser(req))
          return json(res, 403, { error: "La conexión con Garmin solo está disponible desde este equipo." });
      }
      if (pathname === "/api/garmin/status" && req.method === "GET") {
        const child = garminBridge(["status"], {});
        let output = "";
        child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
        const status = await new Promise((resolveStatus) => child.on("close", () => {
          try { resolveStatus(JSON.parse(output.trim())); }
          catch { resolveStatus({ installed: false }); }
        }));
        return json(res, 200, { ...status, connected: existsSync(garminTokenFile(userId)), localOnly: true });
      }
      if (pathname === "/api/garmin/connect" && req.method === "POST") {
        const { email, password } = await bodyJson(req);
        if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password || password.length > 512)
          return json(res, 400, { error: "Introduce el correo y la contraseña de Garmin Connect." });
        const operationId = randomBytes(18).toString("hex");
        const child = spawn(process.env.GARMIN_PYTHON || "python", [join(root, "garmin_bridge.py"), "auth", garminTokenDir(userId)], {
          cwd: root, stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
        });
        const operation = { userId, child, state: "connecting", error: null, buffer: "", expires: Date.now() + 5 * 60 * 1000 };
        garminOperations.set(operationId, operation);
        operation.timeout = setTimeout(() => {
          if (operation.state === "connecting" || operation.state === "mfa_required") {
            operation.state = "error"; operation.error = "La conexión tardó demasiado. Vuelve a intentarlo."; operation.child?.kill();
          }
        }, 5 * 60 * 1000);
        child.stdout.setEncoding("utf8").on("data", (chunk) => {
          operation.buffer += chunk;
          let newline;
          while ((newline = operation.buffer.indexOf("\n")) >= 0) {
            const line = operation.buffer.slice(0, newline).trim(); operation.buffer = operation.buffer.slice(newline + 1);
            try {
              const event = JSON.parse(line);
              if (event.event === "mfa_required") operation.state = "mfa_required";
              else if (event.event === "connected") operation.state = "connected";
              else if (event.event === "error") { operation.state = "error"; operation.error = event.message || "No se pudo iniciar sesión en Garmin Connect."; }
            } catch { operation.state = "error"; operation.error = "Respuesta no válida del servicio de Garmin."; }
          }
        });
        child.on("close", (code) => {
          clearTimeout(operation.timeout);
          if (operation.state === "connecting" || operation.state === "mfa_required") {
            operation.state = code === 0 ? "connected" : "error";
            if (code !== 0) operation.error ||= "No se pudo conectar. Comprueba los datos e inténtalo de nuevo.";
          }
          operation.child = null;
        });
        child.on("error", () => { operation.state = "error"; operation.error = "No se pudo iniciar Python. Comprueba GARMIN_PYTHON y la instalación local."; });
        child.stdin.write(`${JSON.stringify({ email: email.trim(), password })}\n`);
        return json(res, 202, { operationId });
      }
      const garminOperationRoute = pathname.match(/^\/api\/garmin\/connect\/([a-f0-9]+)$/);
      if (garminOperationRoute && req.method === "GET") {
        const operation = garminOperations.get(garminOperationRoute[1]);
        if (!operation || operation.userId !== userId || operation.expires < Date.now()) return json(res, 404, { error: "La operación de conexión ya no está disponible." });
        if (operation.state === "connected" && !existsSync(garminTokenFile(userId)))
          return json(res, 200, { state: "error", error: "Garmin aceptó el acceso, pero no se pudieron guardar los tokens. Vuelve a conectar la cuenta." });
        return json(res, 200, { state: operation.state, error: operation.error });
      }
      if (garminOperationRoute && req.method === "POST") {
        const operation = garminOperations.get(garminOperationRoute[1]);
        if (!operation || operation.userId !== userId || operation.expires < Date.now()) return json(res, 404, { error: "La operación de conexión ya no está disponible." });
        if (operation.state !== "mfa_required" || !operation.child) return json(res, 409, { error: "Garmin no está esperando un código de verificación." });
        const { code } = await bodyJson(req);
        if (typeof code !== "string" || !/^[0-9\s-]{4,12}$/.test(code)) return json(res, 400, { error: "Introduce el código de verificación recibido." });
        operation.state = "connecting";
        operation.child.stdin.write(`${JSON.stringify({ mfa: code.replace(/[\s-]/g, "") })}\n`);
        return json(res, 202, { ok: true });
      }
      if (garminOperationRoute && req.method === "DELETE") {
        const operation = garminOperations.get(garminOperationRoute[1]);
        if (operation?.userId === userId) { operation.child?.kill(); garminOperations.delete(garminOperationRoute[1]); }
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/garmin/disconnect" && req.method === "POST") {
        const { rmSync } = await import("node:fs");
        rmSync(garminTokenDir(userId), { recursive: true, force: true });
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/activities/garmin/preview" && req.method === "POST") {
        const { from, to } = await bodyJson(req);
        if (!isValidGarminRange(from, to))
          return json(res, 400, { error: "Elige un rango válido de hasta 366 días." });
        if (!existsSync(garminTokenFile(userId))) return json(res, 409, { error: "Conecta primero tu cuenta de Garmin Connect." });
        const child = garminBridge(["activities", garminTokenDir(userId)], { from, to });
        let stdout = ""; child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
        const result = await new Promise((resolveResult) => child.on("close", (code) => {
          try { resolveResult(code === 0 ? JSON.parse(stdout.trim()) : null); } catch { resolveResult(null); }
        }));
        if (!result || result.error) return json(res, 502, { error: result?.error || "No se pudieron recuperar las actividades de Garmin." });
        const existingRows = db.prepare("SELECT file_hash,data FROM activities WHERE user_id=? AND file_hash LIKE 'garmin:%'").all(userId);
        const existingByHash = new Map(existingRows.map((row) => [row.file_hash, JSON.parse(row.data)]));
        return json(res, 200, { activities: result.activities.map((a) => {
          const previous = existingByHash.get(`garmin:${a.id}`);
          return { ...a, alreadyImported: Boolean(previous), needsDetailRefresh: Boolean(previous && !previous.garminDetailsVersion) };
        }) });
      }
      if (pathname === "/api/activities/garmin/import" && req.method === "POST") {
        const { from, to, activityIds } = await bodyJson(req);
        if (!isValidGarminRange(from, to))
          return json(res, 400, { error: "Elige un rango válido de hasta 366 días." });
        if (!Array.isArray(activityIds) || !activityIds.length || activityIds.length > 500 || !activityIds.every((id) => /^\d+$/.test(String(id)))) return json(res, 400, { error: "Selecciona al menos una actividad válida." });
        if (!existsSync(garminTokenFile(userId))) return json(res, 409, { error: "Conecta primero tu cuenta de Garmin Connect." });
        const child = garminBridge(["activities", garminTokenDir(userId)], { from, to, activityIds: activityIds.map(String) });
        let stdout = ""; child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
        const result = await new Promise((resolveResult) => child.on("close", (code) => { try { resolveResult(code === 0 ? JSON.parse(stdout.trim()) : null); } catch { resolveResult(null); } }));
        if (!result || result.error) return json(res, 502, { error: result?.error || "No se pudieron recuperar las actividades de Garmin." });
        const wanted = new Set(activityIds.map(String)); let imported = 0; let updated = 0; let skipped = 0;
        for (const a of result.activities) {
          if (!wanted.has(String(a.id))) continue;
          const externalGarminId = String(a.id);
          const { id: _externalId, ...garminData } = a;
          const fileHash = `garmin:${externalGarminId}`;
          const activityType = String(a.activityType || "").toLowerCase();
          const type = /run|running|treadmill|trail_run/.test(activityType) ? "run" : /strength|weight|fitness/.test(activityType) ? "strength" : "other";
          const payload = { ...garminData, garminActivityId: externalGarminId, type, source: "Garmin Connect", filename: `garmin-${externalGarminId}`, fileHash, sessionName: a.name || "Actividad Garmin", distanceKm: a.distanceKm || null, durationMin: a.durationMin ?? null, durationSeconds: a.durationSeconds ?? null, avgHeartRate: a.avgHeartRate || null, maxHeartRate: a.maxHeartRate || null, elevationGain: a.elevationGain || null, rpe: null, soreness: "", painWorsening: false, painChangesGait: false, illness: false, poorSleep: false, fatigueHigh: false, note: "Importada directamente desde Garmin Connect." };
          const existing = db.prepare("SELECT id,data FROM activities WHERE user_id=? AND file_hash=?").get(userId, fileHash);
          if (existing) {
            const previous = JSON.parse(existing.data);
            if (previous.garminDetailsVersion) {
              // Repair records imported before internal and Garmin IDs were
              // separated, even when their detail payload is already current.
              if (Object.hasOwn(previous, "id") || !previous.garminActivityId) {
                const repaired = { ...previous, garminActivityId: previous.garminActivityId || externalGarminId };
                delete repaired.id;
                db.prepare("UPDATE activities SET data=? WHERE id=? AND user_id=?").run(JSON.stringify(repaired), existing.id, userId);
                updated++;
              } else skipped++;
              continue;
            }
            const refreshed = { ...previous, ...payload, rpe: previous.rpe ?? null, soreness: previous.soreness || "", painWorsening: Boolean(previous.painWorsening), painChangesGait: Boolean(previous.painChangesGait), illness: Boolean(previous.illness), poorSleep: Boolean(previous.poorSleep), fatigueHigh: Boolean(previous.fatigueHigh), note: previous.note && previous.note !== "Importada directamente desde Garmin Connect." ? previous.note : payload.note };
            delete refreshed.id;
            db.prepare("UPDATE activities SET data=? WHERE id=? AND user_id=?").run(JSON.stringify(refreshed), existing.id, userId); updated++;
            continue;
          }
          try { db.prepare("INSERT INTO activities(user_id,file_hash,created_at,data) VALUES(?,?,?,?)").run(userId, fileHash, new Date().toISOString(), JSON.stringify(payload)); imported++; }
          catch (error) { if (String(error.message).includes("UNIQUE")) skipped++; else throw error; }
        }
        skipped += Math.max(0, wanted.size - imported - updated - skipped);
        return json(res, 201, { imported, updated, skipped });
      }
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
          const allowed = new Set(Object.values(strengthCatalog.groups).flat().map((exercise) => exercise.name));
          const selected = new Set(config.exercises || []);
          const selectedPatterns = new Set(Object.values(strengthCatalog.groups).flat().filter((exercise) => selected.has(exercise.name)).map((exercise) => exercise.pattern));
          const coverage = config.division === "Cuerpo completo"
            ? selectedPatterns.has("Rodilla bilateral") && selectedPatterns.has("Bisagra de cadera") && selectedPatterns.has("Empuje horizontal") && selectedPatterns.has("Tirón horizontal")
            : selectedPatterns.has("Rodilla bilateral") && selectedPatterns.has("Bisagra de cadera") && selectedPatterns.has("Flexión de rodilla") && selectedPatterns.has("Empuje horizontal") && selectedPatterns.has("Tirón horizontal") && selectedPatterns.has("Tirón vertical");
          if (!strengthCatalog.divisions.includes(config.division) || !config.exercises.length || config.exercises.some((name) => !allowed.has(name)) || new Set(config.exercises).size !== config.exercises.length || !coverage)
            return json(res, 400, { error: "La selección debe cubrir los patrones principales de la división. Cuerpo completo requiere rodilla, bisagra, empuje horizontal y tirón horizontal; torso/pierna y empuje/tirón/pierna requieren además flexión de rodilla y tirón vertical." });
          db.prepare("INSERT INTO app_settings(key,data) VALUES('strength',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(JSON.stringify({ ...config, exercises: [...config.exercises] }));
          return json(res, 200, { ok: true });
        }
        if (pathname === "/api/admin/ai" && req.method === "GET") {
          const { apiKey, ...config } = aiConfig();
          return json(res, 200, { ...config, apiKeyConfigured: Boolean(apiKey) });
        }
        if (pathname === "/api/admin/ai" && req.method === "PUT") {
          const input = await bodyJson(req);
          const current = aiConfig();
          const config = {
            enabled: input.enabled === true,
            apiKey: input.clearApiKey === true ? "" : typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : current.apiKey,
            model: typeof input.model === "string" ? input.model.trim() : "",
            temperature: Number(input.temperature),
            topP: Number(input.topP),
            maxCompletionTokens: Number(input.maxCompletionTokens),
            timeoutSeconds: Number(input.timeoutSeconds),
            jsonMode: input.jsonMode === true,
          };
          if (!config.model || config.model.length > 100 || !Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2 || !Number.isFinite(config.topP) || config.topP < 0 || config.topP > 1 || !Number.isInteger(config.maxCompletionTokens) || config.maxCompletionTokens < 1 || config.maxCompletionTokens > 32000 || !Number.isInteger(config.timeoutSeconds) || config.timeoutSeconds < 5 || config.timeoutSeconds > 300 || config.apiKey.length > 500)
            return json(res, 400, { error: "Revisa el modelo, la temperatura, top P, los tokens, el tiempo de espera y la longitud de la API key." });
          db.prepare("INSERT INTO app_settings(key,data) VALUES('ai',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(JSON.stringify(config));
          return json(res, 200, { ok: true, apiKeyConfigured: Boolean(config.apiKey) });
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
          planHistory: db
            .prepare("SELECT version, created_at AS createdAt, data FROM plans WHERE user_id=? ORDER BY version DESC")
            .all(userId)
            .map((row, index) => {
              const plan = JSON.parse(row.data);
              return {
                version: row.version,
                createdAt: plan.createdAt || row.createdAt,
                savedAt: plan.savedAt || null,
                restoredFromVersion: plan.restoredFromVersion || null,
                goal: plan.goal || null,
                weeks: plan.weeks || 0,
                sessionCount: Array.isArray(plan.sessions) ? plan.sessions.length : 0,
                isActive: index === 0,
              };
            }),
          planVersions: db
            .prepare(
              "SELECT version, created_at AS createdAt FROM plans WHERE user_id=? ORDER BY version DESC",
            )
            .all(userId),
          activities: activities(userId),
          proposal: latestProposal(userId),
        });
      const activityDetailRoute = pathname.match(/^\/api\/activities\/(\d+)$/);
      const activityAssignRoute = pathname.match(/^\/api\/activities\/(\d+)\/assign$/);
      if (activityAssignRoute && req.method === "POST") {
        const activityId = Number(activityAssignRoute[1]);
        const { sessionId } = await bodyJson(req);
        if (typeof sessionId !== "string" || !sessionId)
          return json(res, 400, { error: "Selecciona una sesión válida del plan." });
        const planRow = db.prepare("SELECT version,data FROM plans WHERE user_id=? ORDER BY version DESC LIMIT 1").get(userId);
        if (!planRow) return json(res, 404, { error: "No hay un plan activo." });
        const plan = JSON.parse(planRow.data);
        const activityRow = db.prepare("SELECT id,data FROM activities WHERE id=? AND user_id=?").get(activityId, userId);
        if (!activityRow) return json(res, 404, { error: "No se encontró esta actividad." });
        const activity = JSON.parse(activityRow.data);
        const session = plan.sessions.find((item) => item.id === sessionId);
        if (!session) return json(res, 404, { error: "No se encontró la sesión en el plan activo." });
        if (session.type === "strength" || session.status === "skipped")
          return json(res, 409, { error: "Solo puedes asociar actividades a sesiones de carrera disponibles." });
        if (session.activityId && Number(session.activityId) !== activityId)
          return json(res, 409, { error: "Esta sesión ya tiene otra actividad asociada." });
        if (activity.sessionId && activity.sessionId !== sessionId)
          return json(res, 409, { error: "Esta actividad ya está asociada a otra sesión." });
        for (const other of plan.sessions) {
          if (other.id !== sessionId && Number(other.activityId) === activityId)
            return json(res, 409, { error: "Esta actividad ya está asociada a otra sesión del plan." });
        }
        session.activityId = activityId;
        session.activityFileName = activity.filename || activity.sessionName || activity.source || "Actividad del historial";
        session.activityDate = activity.date;
        activity.sessionId = session.id;
        activity.sessionName = session.title;
        activity.planVersion = Number(planRow.version);
        db.exec("BEGIN");
        try {
          db.prepare("UPDATE activities SET data=? WHERE id=? AND user_id=?").run(JSON.stringify(activity), activityId, userId);
          db.prepare("UPDATE plans SET data=? WHERE user_id=? AND version=?").run(JSON.stringify(plan), userId, planRow.version);
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        return json(res, 200, { ok: true, activityId, sessionId, planVersion: Number(planRow.version) });
      }
      if (activityDetailRoute && req.method === "GET") {
        const row = db
          .prepare(
            "SELECT id, created_at, data FROM activities WHERE id=? AND user_id=?",
          )
          .get(Number(activityDetailRoute[1]), userId);
        if (!row)
          return json(res, 404, { error: "No se encontró esta actividad." });
        return json(res, 200, {
          ...JSON.parse(row.data),
          id: Number(row.id),
          createdAt: row.created_at,
        });
      }
      if (activityDetailRoute && req.method === "DELETE") {
        const activityId = Number(activityDetailRoute[1]);
        const row = db.prepare("SELECT data FROM activities WHERE id=? AND user_id=?").get(activityId, userId);
        if (!row) return json(res, 404, { error: "No se encontró esta actividad." });
        const activity = JSON.parse(row.data);
        if (!["FIT", "GPX", "GARMIN CONNECT"].includes(String(activity.source || "").toUpperCase()))
          return json(res, 409, { error: "Solo se pueden borrar actividades importadas desde un archivo o Garmin Connect." });
        let detachedSessions = 0;
        db.exec("BEGIN");
        try {
          const plans = db.prepare("SELECT version,data FROM plans WHERE user_id=?").all(userId);
          for (const planRow of plans) {
            const plan = JSON.parse(planRow.data);
            let changed = false;
            for (const plannedSession of plan.sessions || []) {
              if (Number(plannedSession.activityId) !== activityId) continue;
              delete plannedSession.activityId;
              delete plannedSession.activityFileName;
              delete plannedSession.activityDate;
              changed = true;
              detachedSessions++;
            }
            if (changed) db.prepare("UPDATE plans SET data=? WHERE user_id=? AND version=?").run(JSON.stringify(plan), userId, planRow.version);
          }
          db.prepare("DELETE FROM activities WHERE id=? AND user_id=?").run(activityId, userId);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        return json(res, 200, { ok: true, deletedActivityId: activityId, detachedSessions });
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
        if (!Number.isFinite(Number(p.age)) || Number(p.age) < 18 || Number(p.age) > 100)
          return json(res, 400, { error: "El perfil de planificación debe corresponder a una persona adulta (18 años o más)." });
        for (const [minutesKey, dateKey, minMinutes, maxMinutes] of [
          ["recent5kMin", "recent5kDate", 10, 120],
          ["recent10kMin", "recent10kDate", 20, 240],
          ["recentHalfMin", "recentHalfDate", 45, 600],
        ]) {
          const mark = p[minutesKey];
          const markDate = p[dateKey];
          if (mark !== undefined && mark !== "" && (!Number.isFinite(Number(mark)) || Number(mark) < minMinutes || Number(mark) > maxMinutes))
            return json(res, 400, { error: `La marca ${minutesKey} está fuera del rango permitido.` });
          if (markDate && (!/^\d{4}-\d{2}-\d{2}$/.test(markDate) || Number.isNaN(new Date(`${markDate}T00:00:00`).getTime()) || markDate > isoDay(new Date())))
            return json(res, 400, { error: `La fecha ${dateKey} debe ser válida y no futura.` });
        }
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
        if (p.strengthEquipment !== undefined && (!Array.isArray(p.strengthEquipment) || p.strengthEquipment.some((item) => !["Mancuernas", "Banda elástica", "Banco/cajón", "Barra y discos", "Rack", "Barra EZ", "Barra de dominadas", "Banco romano"].includes(item)) || new Set(p.strengthEquipment).size !== p.strengthEquipment.length))
          return json(res,400,{error:"El material de fuerza seleccionado no es válido."});
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
        if (!["5", "10", "21.097"].includes(String(g.distanceKm)) || !g.raceDate)
          return json(res, 400, {
            error: "Selecciona 5K, 10K o media maratón y una fecha válida.",
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
        const previous = db.prepare("SELECT version, data FROM plans WHERE user_id=? ORDER BY version DESC LIMIT 1").get(userId);
        const version = db
          .prepare(
            "SELECT COALESCE(MAX(version),0)+1 AS n FROM plans WHERE user_id=?",
          )
          .get(userId).n;
        const plan = generateHybridPlan(profile(userId), goal(userId), version, strengthConfig(), strengthCatalog, activities(userId));
        if (previous) {
          const previousPlan = JSON.parse(previous.data);
          previousPlan.savedAt ||= new Date().toISOString();
          db.prepare("UPDATE plans SET data=? WHERE user_id=? AND version=?").run(JSON.stringify(previousPlan), userId, previous.version);
        }
        db.prepare(
          "INSERT INTO plans(user_id,version,created_at,data) VALUES(?,?,?,?)",
        ).run(userId, version, plan.generatedAt || new Date().toISOString(), JSON.stringify(plan));
        db.prepare(
          "UPDATE proposals SET status='dismissed' WHERE user_id=? AND status='pending'",
        ).run(userId);
        return json(res, 201, { plan });
      }
      const planHistoryRoute = pathname.match(/^\/api\/plans\/(\d+)\/(save|restore|delete)$/);
      if (planHistoryRoute) {
        const sourceVersion = Number(planHistoryRoute[1]);
        const action = planHistoryRoute[2];
        const row = db.prepare("SELECT data FROM plans WHERE user_id=? AND version=?").get(userId, sourceVersion);
        if (!row) return json(res, 404, { error: "No se encontró ese plan en tu histórico." });
        if (action === "delete") {
          if (req.method !== "DELETE") return json(res, 405, { error: "Método no permitido." });
          if (latestPlan(userId)?.version === sourceVersion) return json(res, 409, { error: "No se puede borrar el plan activo. Recupera otra versión primero." });
          db.prepare("DELETE FROM plans WHERE user_id=? AND version=?").run(userId, sourceVersion);
          return json(res, 200, { ok: true, deletedVersion: sourceVersion });
        }
        if (req.method !== "POST") return json(res, 405, { error: "Método no permitido." });
        const source = JSON.parse(row.data);
        if (action === "save") {
          if (latestPlan(userId)?.version !== sourceVersion) return json(res, 409, { error: "Solo puedes guardar manualmente el plan activo." });
          source.savedAt ||= new Date().toISOString();
          db.prepare("UPDATE plans SET data=? WHERE user_id=? AND version=?").run(JSON.stringify(source), userId, sourceVersion);
          return json(res, 200, { plan: source });
        }
        const firstSessionDate = (source.sessions || []).filter((session) => session.type !== "race" && /^\d{4}-\d{2}-\d{2}$/.test(session.date || "")).map((session) => session.date).sort()[0];
        if (!firstSessionDate) return json(res, 409, { error: "Este plan no contiene sesiones que se puedan recuperar." });
        const now = new Date();
        const todayKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
        const shiftDays = Math.round((Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${firstSessionDate}T00:00:00Z`)) / 86400000);
        const shiftDate = (date) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return date;
          const shifted = new Date(`${date}T00:00:00Z`);
          shifted.setUTCDate(shifted.getUTCDate() + shiftDays);
          return shifted.toISOString().slice(0,10);
        };
        const version = db.prepare("SELECT COALESCE(MAX(version),0)+1 AS n FROM plans WHERE user_id=?").get(userId).n;
        const dayLabels = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
        const restored = {
          ...source,
          version,
          createdAt: now.toISOString(),
          savedAt: null,
          restoredFromVersion: sourceVersion,
          previousVersion: latestPlan(userId)?.version || null,
          changeReason: `Recuperado del plan v${sourceVersion}; fechas desplazadas ${shiftDays >= 0 ? "" : "hacia atrás "}${Math.abs(shiftDays)} día(s) para empezar hoy.`,
          goal: { ...source.goal, raceDate: shiftDate(source.goal?.raceDate) },
          sessions: source.sessions.map((session, index) => {
            const date = shiftDate(session.date);
            const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
            const { activityId, activityFileName, activityDate, readiness, readinessAt, adaptation, safetyAction, ...clean } = session;
            return { ...clean, id: `restore-v${version}-${index}`, date, day: dayLabels[weekday], status: "pending" };
          }),
        };
        const activeBeforeRestore = db.prepare("SELECT version, data FROM plans WHERE user_id=? ORDER BY version DESC LIMIT 1").get(userId);
        if (activeBeforeRestore) {
          const previousActive = JSON.parse(activeBeforeRestore.data);
          previousActive.savedAt ||= now.toISOString();
          db.prepare("UPDATE plans SET data=? WHERE user_id=? AND version=?").run(JSON.stringify(previousActive), userId, activeBeforeRestore.version);
        }
        if (sourceVersion !== activeBeforeRestore?.version) {
          source.savedAt ||= now.toISOString();
          db.prepare("UPDATE plans SET data=? WHERE user_id=? AND version=?").run(JSON.stringify(source), userId, sourceVersion);
        }
        db.prepare("INSERT INTO plans(user_id,version,created_at,data) VALUES(?,?,?,?)").run(userId, version, now.toISOString(), JSON.stringify(restored));
        db.prepare("UPDATE proposals SET status='dismissed' WHERE user_id=? AND status='pending'").run(userId);
        return json(res, 201, { plan: restored });
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
        if (session.type === "strength") return json(res, 409, { error: "No se pueden asociar archivos FIT a sesiones de fuerza." });
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
            const reducedDuration=session.type==="run"?Math.max(30,Math.floor(Number(session.durationMin||30)*0.75/5)*5):Math.max(10,Math.round(Number(session.durationMin||30)*0.75));
            scaleSessionDuration(session, reducedDuration);
            if (session.type === "run") {
              session.title = session.title.includes("Tirada") ? "Rodaje largo reducido · fácil" : "Rodaje fácil reducido";
              session.category = "DELOAD_RUN";
              session.effort = "RPE 2–3 · fácil";
              session.paceReference = null;
              refreshRunSessionPrescription(session, reducedDuration, goal(userId));
            } else {
              reduceStrengthSession(session, " Reduce accesorios y detén cualquier movimiento que cause dolor.");
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
            const reducedDuration=next.type==="run"?Math.max(30,Math.floor(Number(session.durationMin||30)*factor/5)*5):Math.max(10,Math.round(Number(session.durationMin||30)*factor));
            scaleSessionDuration(next,reducedDuration);
            if(next.type==="run") { next.title=session.title.includes("Tirada")?"Tirada reducida y fácil":"Rodaje fácil reducido"; next.category="DELOAD_RUN"; next.paceReference=null; refreshRunSessionPrescription(next,reducedDuration,goal(userId)); }
            else reduceStrengthSession(next);
            return next;
          }
          if(assessment.state==="PROGRESS"&&session.type==="run"&&completedRunMinutes>0) {
            let duration=Math.floor(Number(session.durationMin||30)*(1+progressionPct)/5)*5;
            const athleteProfile=profile(userId);
            const sessionDay=new Date(`${session.date}T12:00:00`).getDay();
            const sessionDayIndex=(sessionDay+6)%7;
            const dayLimit=Number(athleteProfile?.trainingSchedule?.[sessionDayIndex]?.maxSessionMinutes||athleteProfile?.maxSessionMinutes||300);
            const otherDayMinutes=plan.sessions.filter((other)=>other.id!==session.id&&other.date===session.date&&other.status==="pending"&&other.type!=="race").reduce((sum,other)=>sum+Number(other.durationMin||0),0);
            duration=Math.min(duration,Math.floor((dayLimit-otherDayMinutes)/5)*5);
            if(session.category==="LONG_RUN"&&completedLongestRun>0) duration=Math.min(duration,Math.floor(completedLongestRun*(1+progressionPct)/5)*5);
            if(duration<30) return {...session,status:"skipped",adaptation:`SESSION_REMOVED · ${assessment.ruleId}`,safetyAction:"Se omitió para respetar el mínimo de 30 min y el límite conjunto del día; no la recuperes en otra fecha."};
            const next={...session,adaptation:`PROGRESS · ${assessment.ruleId}`,safetyAction:`Carga ajustada un máximo de ${Math.round(progressionPct*100)}% tras cumplimiento alto y recuperación adecuada.`};
            scaleSessionDuration(next,duration);
            refreshRunSessionPrescription(next,duration,goal(userId));
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
          savedAt: null,
          previousVersion: proposal.planVersion,
          changeReason: proposal.reason,
        };
        const previousPlan = db.prepare("SELECT data FROM plans WHERE user_id=? AND version=?").get(userId, latest.version);
        if (previousPlan) {
          const archived = JSON.parse(previousPlan.data);
          archived.savedAt ||= revised.createdAt;
          db.prepare("UPDATE plans SET data=? WHERE user_id=? AND version=?").run(JSON.stringify(archived), userId, latest.version);
        }
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
      if (pathname === "/api/import-plan" && req.method === "POST") {
        const incoming = await bodyJson(req, 16 * 1024 * 1024);
        const sourcePlan = incoming?.plan;
        const supportedDistances = [5, 10, 21.1];
        if (incoming?.format !== "stride-plan-import-v1" || !sourcePlan || !supportedDistances.includes(Number(sourcePlan.goal?.distanceKm)) || !/^\d{4}-\d{2}-\d{2}$/.test(sourcePlan.goal?.raceDate || "") || !Array.isArray(sourcePlan.sessions) || sourcePlan.sessions.length < 1 || sourcePlan.sessions.length > 500 || !Number.isInteger(Number(sourcePlan.weeks)) || Number(sourcePlan.weeks) < 1 || Number(sourcePlan.weeks) > 60)
          return json(res, 400, { error: "El archivo no contiene un plan compatible con Rompesuelas." });
        const validTypes = new Set(["run", "strength", "recovery", "race"]);
        const dateIsValid = (date) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
          const parsed = new Date(`${date}T12:00:00Z`);
          return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
        };
        if (sourcePlan.sessions.some((item) => !item || !validTypes.has(item.type) || !dateIsValid(item.date) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 200 || typeof item.details !== "string" || item.details.length > 8000))
          return json(res, 400, { error: "El plan incluye una sesión con datos incompletos o no válidos." });
        const latest = db.prepare("SELECT version,data FROM plans WHERE user_id=? ORDER BY version DESC LIMIT 1").get(userId);
        const version = Number(db.prepare("SELECT COALESCE(MAX(version),0)+1 AS n FROM plans WHERE user_id=?").get(userId).n);
        const now = new Date().toISOString();
        const dayLabels = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
        const imported = {
          ...sourcePlan,
          version,
          createdAt: now,
          savedAt: null,
          restoredFromVersion: null,
          previousVersion: latest ? Number(latest.version) : null,
          importedFrom: typeof incoming.source?.fileName === "string" ? incoming.source.fileName.slice(0, 180) : "Archivo JSON de plan",
          sessions: sourcePlan.sessions.map((item, index) => {
            const weekday = new Date(`${item.date}T12:00:00Z`).getUTCDay();
            return {
              ...item,
              id: `import-v${version}-${index + 1}`,
              date: item.date,
              day: dayLabels[weekday],
              week: Number(item.week),
              status: ["completed", "skipped", "pending"].includes(item.status) ? item.status : "pending",
            };
          }).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)),
        };
        db.exec("BEGIN IMMEDIATE");
        try {
          if (latest) {
            const previous = JSON.parse(latest.data);
            previous.savedAt ||= now;
            db.prepare("UPDATE plans SET data=? WHERE user_id=? AND version=?").run(JSON.stringify(previous), userId, latest.version);
          }
          db.prepare("INSERT INTO plans(user_id,version,created_at,data) VALUES(?,?,?,?)").run(userId, version, now, JSON.stringify(imported));
          saveSingleton("goal", userId, imported.goal);
          db.prepare("UPDATE proposals SET status='dismissed' WHERE user_id=? AND status='pending'").run(userId);
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        return json(res, 201, { ok: true, plan: imported, preservedProfileAndActivities: true });
      }
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

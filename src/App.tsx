import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Dumbbell,
  FileUp,
  Footprints,
  Gauge,
  HeartPulse,
  History,
  House,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  UserRound,
  X,
} from "lucide-react";

type Session = {
  id: string;
  date: string;
  day: string;
  week: number;
  phase: string;
  type: string;
  title: string;
  distanceKm?: number;
  durationMin?: number | null;
  effort: string;
  details: string;
  status: string;
  adaptation?: string;
  safetyAction?: string;
  readiness?: Record<string, boolean>;
  readinessAt?: string;
  activityId?: number;
  activityFileName?: string;
  activityDate?: string;
  load?: { cardiovascular: number; impact: number; neuromuscular: number; strength: number };
};
type Plan = {
  algorithmVersion: string;
  rulesetVersion: string;
  rulesReviewed?: string;
  athleteLevel?: number;
  goalAssessment?: { classification: string; reasons: string[]; predictedTimeMin?: number | null; predictedRangeMin?: {lower:number;central:number;upper:number}|null; alternatives?: string[] };
  warnings?: string[];
  decisions?: { code: string; ruleId: string; reason: string }[];
  runningMetric?: string;
  version: number;
  createdAt: string;
  previousVersion?: number;
  changeReason?: string;
  goal: Goal;
  weeks: number;
  sessions: Session[];
  notes: string[];
};
type Profile = {
  name: string;
  age: string;
  weightKg: string;
  heightCm: string;
  experience: string;
  weeklyKm: string;
  longestRunKm: string;
  recent5kMin: string;
  recent5kDate: string;
  runningExperienceMonths: string;
  strengthExperienceMonths: string;
  currentWeeklyRuns: string;
  currentWeeklyMinutes: string;
  longestRunMinutes: string;
  continuousRunMinutes: string;
  weeksSinceTraining: string;
  canWalk30Minutes: boolean;
  painWhileWalking: boolean;
  maxSessionMinutes: string;
  preferredRunningMetric: string;
  trainingPriority: string;
  gymAccess: boolean;
  healthScreening: Record<string, boolean>;
  healthScreeningReviewed: boolean;
  precautionScreening: Record<string, boolean>;
  recoveryProfile: { sleepHours: string; sleepQuality: string; stress: string; physicalWork?: boolean; frequentTravel?: boolean };
  trainingSchedule: DayTraining[];
  limitations: string;
  preferences: string;
};
type DayTraining = {
  strength: boolean;
  treadmill: boolean;
  street: boolean;
  longRun: boolean;
  maxSessionMinutes?: string | number;
};
type Goal = {
  distanceKm: number;
  raceDate: string;
  targetTimeMin: number | string | null;
  priority?: string;
  terrain?: string;
  elevationGainM?: number | string;
};
type ActivityLog = {
  id?: number;
  fileHash?: string;
  source?: string;
  filename?: string;
  date: string;
  type: string;
  distanceKm?: number | null;
  durationMin?: number | null;
  avgHeartRate?: number | null;
  maxHeartRate?: number | null;
  rpe: number | string | null;
  soreness: string;
  painWorsening?: boolean;
  painChangesGait?: boolean;
  illness?: boolean;
  poorSleep?: boolean;
  fatigueHigh?: boolean;
  note: string;
  createdAt?: string;
  sessionId?: string;
  sessionName?: string;
  planVersion?: number;
  fitData?: Record<string, unknown>;
};
type AppData = {
  profile: Profile | null;
  goal: Goal | null;
  plan: Plan | null;
  planVersions: { version: number; createdAt: string }[];
  activities: ActivityLog[];
  proposal: null | {
    id: number;
    reason: string;
    planVersion: number;
    weeklyReview?: { plannedSessions: number; completedSessions: number; plannedDurationMinutes?: number; completedDurationMinutes?: number; plannedLoad?: number; completedLoad?: number; breakDays?: number };
    plan: Plan;
  };
};
type View =
  | "overview"
  | "plan"
  | "history"
  | "profile"
  | "settings"
  | "admin"
  | "activity-detail";

const dayNames = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];
const dayShort = ["L", "M", "X", "J", "V", "S", "D"];
const emptyDayTraining: DayTraining = {
  strength: false,
  treadmill: false,
  street: false,
  longRun: false,
  maxSessionMinutes: "90",
};
const healthQuestions = [
  ["chestPain", "Dolor o presión torácica durante el esfuerzo"],
  ["fainting", "Desmayo o pérdida de conciencia"],
  ["unusualBreathlessness", "Falta de aire desproporcionada o inexplicable"],
  ["palpitationsWithSymptoms", "Palpitaciones con mareo o malestar"],
  ["heartConditionWithoutClearance", "Enfermedad cardiovascular sin autorización para entrenar"],
  ["acutePainChangesGait", "Dolor agudo que altera la marcha"],
  ["cannotBearWeight", "Incapacidad para apoyar peso"],
  ["majorSwelling", "Inflamación importante tras una lesión"],
  ["fever", "Fiebre o febrícula"],
  ["neurologicalSymptoms", "Síntomas neurológicos recientes"],
  ["recentSurgeryWithoutClearance", "Cirugía reciente sin alta para ejercicio"],
  ["progressivePain", "Dolor que empeora progresivamente durante varios días"],
] as const;
const precautionQuestions = [
  ["recurrentInjury", "Lesión previa recurrente"],
  ["recentIllness", "Regreso reciente tras enfermedad"],
  ["diabetesOrHypertension", "Diabetes o hipertensión"],
  ["respiratoryCondition", "Enfermedad respiratoria"],
  ["pregnancyOrPostpartum", "Embarazo o posparto"],
  ["heartRateMedication", "Medicación que afecta a la frecuencia cardiaca"],
] as const;
const defaultProfile: Profile = {
  name: "",
  age: "",
  weightKg: "",
  heightCm: "",
  experience: "intermedio",
  weeklyKm: "12",
  longestRunKm: "6",
  recent5kMin: "",
  recent5kDate: "",
  runningExperienceMonths: "0",
  strengthExperienceMonths: "0",
  currentWeeklyRuns: "0",
  currentWeeklyMinutes: "0",
  longestRunMinutes: "0",
  continuousRunMinutes: "0",
  weeksSinceTraining: "0",
  canWalk30Minutes: true,
  painWhileWalking: false,
  maxSessionMinutes: "90",
  preferredRunningMetric: "time",
  trainingPriority: "balanced",
  gymAccess: true,
  healthScreening: {},
  healthScreeningReviewed: false,
  precautionScreening: {},
  recoveryProfile: { sleepHours: "7", sleepQuality: "3", stress: "2", physicalWork: false, frequentTravel: false },
  trainingSchedule: [
    { ...emptyDayTraining, street: true },
    { ...emptyDayTraining },
    { ...emptyDayTraining, strength: true },
    { ...emptyDayTraining },
    { ...emptyDayTraining, strength: true },
    { ...emptyDayTraining },
    { ...emptyDayTraining, street: true, longRun: true },
  ],
  limitations: "",
  preferences: "",
};
function normalizedProfile(value: Profile | null): Profile {
  if (!value) return { ...defaultProfile };
  const legacy = value as Profile & {
    trainingDays?: number[];
    equipment?: string[];
  };
  const {
    trainingDays: _trainingDays,
    equipment: _equipment,
    ...storedProfile
  } = legacy;
  if (Array.isArray(legacy.trainingSchedule))
    return {
      ...defaultProfile,
      ...storedProfile,
      healthScreening: { ...defaultProfile.healthScreening, ...storedProfile.healthScreening },
      precautionScreening: { ...defaultProfile.precautionScreening, ...storedProfile.precautionScreening },
      recoveryProfile: { ...defaultProfile.recoveryProfile, ...storedProfile.recoveryProfile },
      trainingSchedule: (() => {
        let longRunAssigned = false;
        return Array.from({ length: 7 }, (_, day) => {
          const stored = legacy.trainingSchedule[day] || emptyDayTraining;
          const longRun = Boolean(
            stored.longRun && stored.street && !longRunAssigned,
          );
          if (longRun) longRunAssigned = true;
          return {
            strength: Boolean(stored.strength),
            treadmill: Boolean(stored.treadmill),
            street: Boolean(stored.street),
            longRun,
            maxSessionMinutes: String(stored.maxSessionMinutes || storedProfile.maxSessionMinutes || "90"),
          };
        });
      })(),
    };

  // Preserve the intent of profiles created before per-day session selection existed.
  const oldDays = Array.isArray(legacy.trainingDays)
    ? legacy.trainingDays
        .map(Number)
        .filter((day) => day >= 0 && day < 7)
        .sort((a, b) => a - b)
    : [];
  const oldRuns =
    oldDays.length >= 5
      ? [oldDays[0], oldDays[Math.floor(oldDays.length / 2)], oldDays.at(-1)!]
      : oldDays.length >= 3
        ? [oldDays[0], oldDays[Math.floor(oldDays.length / 2)]]
        : oldDays.slice(0, 1);
  const oldStrength =
    oldDays.length >= 5
      ? [oldDays[1], oldDays[oldDays.length - 2]]
      : oldDays.length >= 4
        ? [oldDays[1], oldDays.at(-1)!]
        : oldDays.length
          ? [oldDays.at(-1)!]
          : [];
  const trainingSchedule = Array.from({ length: 7 }, (_, day) => ({
    ...emptyDayTraining,
    street: oldRuns.includes(day),
    longRun: oldRuns.length > 0 && oldRuns.at(-1) === day,
    strength: oldStrength.includes(day),
  }));
  return { ...defaultProfile, ...storedProfile, trainingSchedule };
}
function activeTrainingDays(schedule: DayTraining[]) {
  return schedule.filter((day) => day.strength || day.treadmill || day.street)
    .length;
}
function hasRunningSession(schedule: DayTraining[]) {
  return schedule.some((day) => day.treadmill || day.street);
}
const emptyState: AppData = {
  profile: null,
  goal: null,
  plan: null,
  planVersions: [],
  activities: [],
  proposal: null,
};
const viewMeta: Record<View, { title: string; subtitle: string }> = {
  overview: {
    title: "Panel de entrenamiento",
    subtitle: "Una mirada clara a tu preparación.",
  },
  plan: {
    title: "Tu planificación",
    subtitle: "Carrera y fuerza, en equilibrio semana a semana.",
  },
  history: {
    title: "Actividad y progreso",
    subtitle: "Cada sesión suma una pieza a tu evolución.",
  },
  profile: {
    title: "Tu perfil deportivo",
    subtitle: "El contexto que da forma a cada entrenamiento.",
  },
  settings: {
    title: "Ajustes y datos",
    subtitle: "Mantén tu historial local seguro y portable.",
  },
  admin: {
    title: "Administración",
    subtitle: "Gestiona las cuentas registradas en Rompesuelas.",
  },
  "activity-detail": {
    title: "Detalle de actividad",
    subtitle: "Todos los datos registrados en el archivo FIT.",
  },
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body instanceof Blob
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json")
    ? await response.json()
    : await response.blob();
  if (!response.ok)
    throw new Error(
      (body as { error?: string })?.error ||
        "No se pudo completar la solicitud.",
    );
  return body as T;
}
function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function prettyDate(
  date: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
) {
  return new Intl.DateTimeFormat("es-ES", options).format(
    new Date(`${date}T12:00:00`),
  );
}
function weekDates(day: string) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(date);
    d.setDate(date.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}
function formatMinutes(minutes?: number | null) {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m ? `${m} min` : ""}` : `${m} min`;
}
function formatDistance(distance?: number | null) {
  return distance
    ? `${Number(distance).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km`
    : "—";
}
function goalName(goal?: Goal | null) {
  return goal
    ? `${goal.distanceKm >= 42 ? "Maratón" : goal.distanceKm >= 21 ? "Media maratón" : goal.distanceKm === 1.609 ? "Milla" : `${goal.distanceKm}K`}`
    : "Tu próxima meta";
}
function firstName(name?: string) {
  return name?.trim().split(/\s+/)[0] || "atleta";
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [account, setAccount] = useState<{
    username: string;
    isAdmin: boolean;
  } | null>(null);
  const [data, setData] = useState<AppData>(emptyState);
  const [view, setView] = useState<View>("overview");
  const [selectedActivityId, setSelectedActivityId] = useState<number | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  async function reload() {
    const next = await api<AppData>("/api/state");
    setData(next);
  }
  useEffect(() => {
    api<{ authenticated: boolean; username: string | null; isAdmin: boolean }>(
      "/api/session",
    )
      .then(async (session) => {
        setAuthenticated(session.authenticated);
        setAccount(
          session.username
            ? { username: session.username, isAdmin: session.isAdmin }
            : null,
        );
        setView(session.isAdmin ? "admin" : "overview");
        if (session.authenticated && !session.isAdmin) await reload();
      })
      .catch((e) => {
        setError(e.message);
        setAuthenticated(false);
      });
  }, []);
  useEffect(() => {
    const handler = () => {
      setView("profile");
      setMobileOpen(false);
    };
    window.addEventListener("open-profile", handler);
    return () => window.removeEventListener("open-profile", handler);
  }, []);
  async function action<T>(fn: () => Promise<T>, success?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      if (success) setNotice(success);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ha ocurrido un error.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    await api("/api/logout", { method: "POST", body: "{}" });
    setAuthenticated(false);
    setAccount(null);
    setData(emptyState);
    setView("overview");
    setNotice("");
    setError("");
  }
  if (authenticated === null)
    return (
      <div className="loading-screen">
        <div className="brand-mark">R</div>
        <p>Preparando tu espacio...</p>
      </div>
    );
  if (!authenticated)
    return (
      <LoginScreen
        initialError={error}
        onReady={(user) => {
          setAuthenticated(true);
          setAccount(user);
          setView(user.isAdmin ? "admin" : "overview");
          if (user.isAdmin) setData(emptyState);
          else void reload();
        }}
      />
    );

  if (account?.isAdmin)
    return (
      <AdminWorkspace
        username={account.username}
        notice={notice}
        error={error}
        busy={busy}
        clearNotice={() => setNotice("")}
        clearError={() => setError("")}
        runAction={action}
        signOut={() => void signOut()}
      />
    );

  const navigate = (next: View) => {
    setView(next);
    setMobileOpen(false);
    setNotice("");
    setError("");
  };
  const openActivity = (activityId: number) => {
    setSelectedActivityId(activityId);
    setView("activity-detail");
    setMobileOpen(false);
    setNotice("");
    setError("");
  };
  const completedSessions =
    data.plan?.sessions.filter((session) => session.status === "completed")
      .length || 0;
  const planSessions = data.plan?.sessions.length || 0;
  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="scrim"
          aria-label="Cerrar menú"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <span className="brand-name">Rompesuelas</span>
            <span className="brand-label">RUN CLUB · PLANES HÍBRIDOS</span>
          </div>
          <button
            className="icon-button sidebar-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Cerrar menú"
          >
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-caption">TU ESPACIO</div>
        <nav className="nav-list" aria-label="Navegación principal">
          <NavButton
            active={view === "overview"}
            icon={<House size={18} />}
            label="Resumen"
            onClick={() => navigate("overview")}
          />
          <NavButton
            active={view === "plan"}
            icon={<CalendarDays size={18} />}
            label="Plan de entrenamiento"
            onClick={() => navigate("plan")}
            badge={data.plan ? undefined : "Nuevo"}
          />
          <NavButton
            active={view === "history"}
            icon={<Activity size={18} />}
            label="Actividad"
            onClick={() => navigate("history")}
          />
        </nav>
        <div className="sidebar-caption sidebar-caption-spaced">
          CONFIGURACIÓN
        </div>
        <nav className="nav-list">
          <NavButton
            active={view === "profile"}
            icon={<UserRound size={18} />}
            label="Perfil deportivo"
            onClick={() => navigate("profile")}
          />
          <NavButton
            active={view === "settings"}
            icon={<Settings size={18} />}
            label="Ajustes y datos"
            onClick={() => navigate("settings")}
          />
        </nav>
        <div className="sidebar-bottom">
          <div className="coach-card">
            <div className="coach-icon">
              <Sparkles size={17} />
            </div>
            <div>
              <strong>Entrena con intención</strong>
              <span>La constancia también es progreso.</span>
            </div>
          </div>
          <div className="account-row">
            <div className="avatar">
              {(data.profile?.name || "A").trim().slice(0, 1).toUpperCase()}
            </div>
            <div className="account-copy">
              <strong>
                {data.profile?.name || account?.username || "Tu perfil"}
              </strong>
              <span>
                {account?.isAdmin
                  ? "Administrador"
                  : `Usuario · ${account?.username || ""}`}
              </span>
            </div>
            <button
              className="icon-button logout-button"
              title="Cerrar sesión"
              onClick={() => void signOut()}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button menu-button"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menú"
            >
              <Menu size={20} />
            </button>
            <div className="crumb">
              <span>Rompesuelas</span>
              <span className="crumb-slash">/</span>
              <strong>{viewMeta[view].title}</strong>
            </div>
          </div>
          <div className="topbar-right">
            <span className="local-indicator">
              <span />
              Datos guardados en este dispositivo
            </span>
            <button
              className="top-avatar"
              onClick={() => navigate("profile")}
              aria-label="Abrir perfil"
            >
              {(data.profile?.name || account?.username || "A")
                .trim()
                .slice(0, 1)
                .toUpperCase()}
            </button>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "overview"
                  ? "TU CENTRO DE ENTRENAMIENTO"
                  : "ROMPESUELAS / PERSONAL"}
              </div>
              <h1>{viewMeta[view].title}</h1>
              <p>{viewMeta[view].subtitle}</p>
            </div>
            {view === "plan" && data.plan && (
              <div className="plan-version-pill">
                <span className="version-dot" />
                Versión {data.plan.version}
                <span className="version-divider" />
                {data.plan.weeks} semanas
              </div>
            )}
          </div>
          {notice && (
            <div className="toast toast-success">
              <CheckCircle2 size={17} />
              {notice}
              <button onClick={() => setNotice("")} aria-label="Cerrar">
                <X size={16} />
              </button>
            </div>
          )}
          {error && (
            <div className="toast toast-error">
              <CircleHelp size={17} />
              {error}
              <button onClick={() => setError("")} aria-label="Cerrar">
                <X size={16} />
              </button>
            </div>
          )}
          {view === "overview" && (
            <Dashboard
              data={data}
              completed={completedSessions}
              count={planSessions}
              busy={busy}
              runAction={action}
              refresh={reload}
              navigate={navigate}
            />
          )}
          {view === "plan" && (
            <PlanView
              data={data}
              busy={busy}
              runAction={action}
              refresh={reload}
            />
          )}
          {view === "activity-detail" && selectedActivityId !== null && (
            <ActivityDetailView
              activityId={selectedActivityId}
              onBack={() => navigate("history")}
            />
          )}
          {view === "history" && (
            <HistoryView
              data={data}
              busy={busy}
              runAction={action}
              refresh={reload}
              onOpenActivity={openActivity}
            />
          )}
          {view === "profile" && (
            <ProfileView
              current={data.profile}
              goal={data.goal}
              busy={busy}
              runAction={action}
              refresh={reload}
            />
          )}
          {view === "settings" && (
            <SettingsView runAction={action} refresh={reload} />
          )}
          <footer className="page-footer">
            <span>Hecho para sumar kilómetros, fuerza y buenos hábitos.</span>
            <span>
              <ShieldCheck size={13} />
              Tus datos se quedan en tu red local
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function AdminWorkspace({
  username,
  notice,
  error,
  busy,
  clearNotice,
  clearError,
  runAction,
  signOut,
}: {
  username: string;
  notice: string;
  error: string;
  busy: boolean;
  clearNotice: () => void;
  clearError: () => void;
  runAction: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
  signOut: () => void;
}) {
  const [adminSection, setAdminSection] = useState<"users" | "strength">("users");
  return (
    <div className="app-shell admin-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <span className="brand-name">Rompesuelas</span>
            <span className="brand-label">ADMINISTRACIÓN</span>
          </div>
        </div>
        <div className="sidebar-caption">GESTIÓN</div>
        <nav className="nav-list" aria-label="Administración">
          <NavButton
            active={adminSection === "users"}
            icon={<ShieldCheck size={18} />}
            label="Usuarios"
            onClick={() => setAdminSection("users")}
          />
          <NavButton active={adminSection === "strength"} icon={<Dumbbell size={18} />} label="Entrenamiento de fuerza" onClick={() => setAdminSection("strength")} />
        </nav>
        <div className="sidebar-bottom">
          <div className="account-row">
            <div className="avatar">{username.slice(0, 1).toUpperCase()}</div>
            <div className="account-copy">
              <strong>{username}</strong>
              <span>Administrador</span>
            </div>
            <button
              className="icon-button logout-button"
              title="Cerrar sesión"
              onClick={signOut}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="crumb">
            <span>Rompesuelas</span>
            <span className="crumb-slash">/</span>
            <strong>Administración</strong>
          </div>
          <span className="admin-role-pill">
            <ShieldCheck size={14} /> Administrador
          </span>
          <button
            className="button button-outline admin-logout"
            onClick={signOut}
          >
            <LogOut size={14} /> Cerrar sesión
          </button>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">{adminSection === "users" ? "MANTENIMIENTO DE CUENTAS" : "CONFIGURACIÓN DE PLANES"}</div>
              <h1>{adminSection === "users" ? "Administración de usuarios" : "Entrenamiento de fuerza"}</h1>
              <p>{adminSection === "users" ? "Gestiona accesos y datos de los usuarios de Rompesuelas." : "Define la división y los ejercicios disponibles para elaborar los planes."}</p>
            </div>
          </div>
          {notice && (
            <div className="toast toast-success">
              <CheckCircle2 size={17} />
              {notice}
              <button onClick={clearNotice} aria-label="Cerrar">
                <X size={16} />
              </button>
            </div>
          )}
          {error && (
            <div className="toast toast-error">
              <CircleHelp size={17} />
              {error}
              <button onClick={clearError} aria-label="Cerrar">
                <X size={16} />
              </button>
            </div>
          )}
          {adminSection === "users" ? <AdminView runAction={runAction} /> : <StrengthAdminView runAction={runAction} />}
          <footer className="page-footer">
            <span>Gestión de cuentas y privacidad de datos.</span>
            <span>
              <ShieldCheck size={13} />
              Acceso restringido al administrador
            </span>
          </footer>
          {busy && <span className="admin-busy-indicator">Guardando…</span>}
        </div>
      </main>
    </div>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
  badge,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      className={`nav-button ${active ? "active" : ""}`}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {badge && <i>{badge}</i>}
    </button>
  );
}
function LoginScreen({
  initialError = "",
  onReady,
}: {
  initialError?: string;
  onReady: (user: { username: string; isAdmin: boolean }) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (mode === "register" && password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      const user = await api<{ username: string; isAdmin: boolean }>(
        mode === "register" ? "/api/register" : "/api/login",
        {
          method: "POST",
          body: JSON.stringify({ username, password }),
        },
      );
      onReady(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo iniciar sesión.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-art">
        <div className="auth-art-top">
          <div className="brand-mark">R</div>
          <span>Rompesuelas</span>
        </div>
        <div className="art-rings">
          <span />
          <span />
          <span />
          <div className="art-runner">
            <Footprints size={48} />
          </div>
        </div>
        <div className="auth-art-copy">
          <span className="eyebrow">ENTRENAMIENTO CON PROPÓSITO</span>
          <h2>
            Un plan que
            <br />
            se mueve <em>contigo.</em>
          </h2>
          <p>Carrera y fuerza, unidas por un objetivo.</p>
        </div>
        <span className="art-coordinate">
          CARRERA&nbsp; · &nbsp;FUERZA&nbsp; · &nbsp;RECUPERACIÓN
        </span>
      </div>
      <div className="auth-main">
        <div className="auth-mobile-brand">
          <div className="brand-mark">R</div>
          <b>Rompesuelas</b>
        </div>
        <div className="auth-form-wrap">
          <div className="auth-lock">
            <LockKeyhole size={21} />
          </div>
          <span className="eyebrow">
            {mode === "register" ? "NUEVA CUENTA" : "HOLA DE NUEVO"}
          </span>
          <h1>
            {mode === "register" ? "Crea tu cuenta." : "Qué bueno verte."}
          </h1>
          <p>
            {mode === "register"
              ? "Elige un login y una contraseña para guardar tu entrenamiento."
              : "Entra para seguir construyendo tu progreso."}
          </p>
          <form onSubmit={(e) => void submit(e)} className="auth-form">
            <label>
              Login
              <input
                type="text"
                autoComplete="username"
                minLength={3}
                maxLength={32}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Tu nombre de usuario"
                required
              />
            </label>
            <label>
              Contraseña
              <input
                type="password"
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                minLength={mode === "register" ? 6 : undefined}
                maxLength={256}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  mode === "register"
                    ? "Al menos 6 caracteres"
                    : "Tu contraseña"
                }
                required
              />
            </label>
            {mode === "register" && (
              <label>
                Repite la contraseña
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirma tu contraseña"
                  required
                />
              </label>
            )}
            {error && <div className="inline-error">{error}</div>}
            <button
              className="button button-primary button-full"
              disabled={busy}
            >
              {busy
                ? "Un momento…"
                : mode === "register"
                  ? "Crear usuario"
                  : "Entrar"}
              <ArrowRight size={16} />
            </button>
          </form>
          <button
            type="button"
            className="auth-mode-toggle"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
              setPassword("");
              setConfirm("");
            }}
          >
            {mode === "login"
              ? "¿Aún no tienes usuario? Crear una cuenta"
              : "Ya tengo usuario · Iniciar sesión"}
          </button>
          <div className="auth-privacy">
            <ShieldCheck size={15} />
            <span>Acceso protegido · Sin cuenta externa</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dashboard({
  data,
  completed,
  count,
  busy,
  runAction,
  refresh,
  navigate,
}: {
  data: AppData;
  completed: number;
  count: number;
  busy: boolean;
  runAction: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
  refresh: () => Promise<void>;
  navigate: (view: View) => void;
}) {
  const nextSession = data.plan?.sessions.find(
    (s) => s.status === "pending" && s.date >= todayISO(),
  );
  const thisWeekSessions =
    data.plan?.sessions.filter((s) => {
      const start = weekDates(todayISO())[0];
      const end = weekDates(todayISO())[6];
      return s.date >= start && s.date <= end;
    }) || [];
  const weeklyKm = thisWeekSessions
    .filter((s) => s.type === "run" && s.status !== "skipped")
    .reduce((sum, s) => sum + (s.distanceKm || 0), 0);
  const latest = data.activities[0];
  const goalDate = data.goal?.raceDate;
  const daysToGoal = goalDate
    ? Math.max(
        0,
        Math.ceil(
          (new Date(`${goalDate}T00:00:00`).getTime() -
            new Date(`${todayISO()}T00:00:00`).getTime()) /
            86400000,
        ),
      )
    : 0;
  const progress = count
    ? Math.min(100, Math.round((completed / count) * 100))
    : 0;
  return (
    <>
      <section className="hero-card">
        <div className="hero-copy">
          <div className="hero-kicker">
            <span className="hero-kicker-dot" />
            {data.plan ? "TU CAMINO, A TU RITMO" : "EMPIEZA CON UN BUEN PLAN"}
          </div>
          <h2>
            {data.plan ? (
              <>
                Cada paso te acerca,
                <br />
                <em>{firstName(data.profile?.name)}.</em>
              </>
            ) : (
              <>
                Tu próxima meta
                <br />
                empieza <em>aquí.</em>
              </>
            )}
          </h2>
          <p>
            {data.plan
              ? `Entrenamiento para ${goalName(data.goal)}${daysToGoal ? ` · quedan ${daysToGoal} días` : ""}.`
              : "Cuéntanos un poco de ti y diseñaremos una semana que encaje con tu vida."}
          </p>
          <button
            className="button button-light"
            onClick={() => navigate(data.plan ? "plan" : "profile")}
          >
            {data.plan ? "Ver mi planificación" : "Configurar mi entrenamiento"}
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="hero-visual">
          <div className="sun-glow" />
          <div className="hero-route">
            <span className="route-point route-start" />
            <span className="route-point route-end" />
            <svg viewBox="0 0 300 170" fill="none" aria-hidden="true">
              <path
                d="M8 133 C 47 116, 49 152, 89 123 C 125 96, 133 117, 154 85 C 174 53, 204 89, 213 63 C 222 37, 244 51, 269 23"
                stroke="rgba(255,255,255,.30)"
                strokeWidth="2"
                strokeDasharray="4 8"
              />
              <path
                d="M8 133 C 47 116, 49 152, 89 123 C 125 96, 133 117, 154 85 C 174 53, 204 89, 213 63 C 222 37, 244 51, 269 23"
                stroke="#F5A36C"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <div className="route-label">
              {goalName(data.goal).toUpperCase()}
              <span>OBJETIVO</span>
            </div>
          </div>
          <div className="hero-stamp">
            <Footprints size={19} />
            <span>
              RUN
              <br />
              STRONG
            </span>
          </div>
        </div>
        <div className="hero-noise" />
      </section>
      <div className="stat-grid">
        <StatCard
          icon={<CalendarDays size={18} />}
          label="Plan de entrenamiento"
          value={data.plan ? `${progress}%` : "Pendiente"}
          detail={
            data.plan
              ? `${completed} de ${count} sesiones hechas`
              : "Define tu objetivo para empezar"
          }
          accent="orange"
          progress={progress}
        />
        <StatCard
          icon={<Footprints size={18} />}
          label="Carrera esta semana"
          value={
            data.plan
              ? `${weeklyKm.toLocaleString("es-ES", { maximumFractionDigits: 1 })} km`
              : "—"
          }
          detail={`${thisWeekSessions.filter((s) => s.type === "run").length} sesiones previstas`}
          accent="green"
        />
        <StatCard
          icon={<Activity size={18} />}
          label="Última actividad"
          value={
            latest ? formatDistance(latest.distanceKm) : "Aún sin registros"
          }
          detail={
            latest
              ? prettyDate(latest.date, { day: "numeric", month: "long" })
              : "Importa un FIT o GPX"
          }
          accent="blue"
        />
      </div>
      {data.proposal && (
        <section className="proposal-card">
          <div className="proposal-icon">
            <RefreshCw size={19} />
          </div>
          <div className="proposal-copy">
            <div className="eyebrow">REEVALUACIÓN DISPONIBLE</div>
            <h3>Una semana más inteligente.</h3>
            <p>{data.proposal.reason}</p>
            {data.proposal.weeklyReview && <div className="weekly-review-metrics"><span>Sesiones completadas <strong>{data.proposal.weeklyReview.completedSessions}/{data.proposal.weeklyReview.plannedSessions}</strong></span><span>Minutos realizados <strong>{data.proposal.weeklyReview.completedDurationMinutes ?? 0}/{data.proposal.weeklyReview.plannedDurationMinutes ?? 0}</strong></span>{data.proposal.weeklyReview.breakDays ? <span>Interrupción <strong>{data.proposal.weeklyReview.breakDays} días</strong></span> : null}</div>}
            {data.proposal.plan.sessions.filter((s) => s.adaptation).length >
              0 && (
              <div className="proposal-changes">
                {data.proposal.plan.sessions
                  .filter((s) => s.adaptation)
                  .slice(0, 3)
                  .map((s) => (
                    <span key={s.id}>
                      <strong>
                        {prettyDate(s.date, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}{" "}
                        · {s.title}
                      </strong>
                      <small>{s.adaptation}</small>
                    </span>
                  ))}
              </div>
            )}
          </div>
          <div className="proposal-actions">
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() =>
                void runAction(async () => {
                  await api(`/api/adaptation/${data.proposal!.id}/accept`, {
                    method: "POST",
                    body: "{}",
                  });
                  await refresh();
                  return true;
                }, "Propuesta aceptada. Se ha guardado como una nueva versión del plan.").then(
                  (result) => {
                    if (result) navigate("plan");
                  },
                )
              }
            >
              Aplicar cambios
              <Check size={15} />
            </button>
            <button
              className="button button-ghost"
              disabled={busy}
              onClick={() =>
                void runAction(async () => {
                  await api(`/api/adaptation/${data.proposal!.id}/dismiss`, {
                    method: "POST",
                    body: "{}",
                  });
                  await refresh();
                }, "Propuesta descartada.")
              }
            >
              Mantener mi plan
            </button>
          </div>
        </section>
      )}
      <div className="dashboard-columns">
        <section className="panel week-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">ESTA SEMANA</div>
              <h3>En tu calendario</h3>
            </div>
            {data.plan && (
              <button className="text-link" onClick={() => navigate("plan")}>
                Ver plan completo <ArrowRight size={14} />
              </button>
            )}
          </div>
          {data.plan ? (
            <WeekPreview sessions={thisWeekSessions} />
          ) : (
            <EmptyPlan onClick={() => navigate("profile")} />
          )}
        </section>
        <section className="panel goal-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">OBJETIVO PRINCIPAL</div>
              <h3>{goalName(data.goal)}</h3>
            </div>
            <div className="goal-icon">
              <Target size={20} />
            </div>
          </div>
          {data.goal ? (
            <>
              <div className="goal-date">
                <CalendarDays size={16} />
                {prettyDate(data.goal.raceDate, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </div>
              <div className="goal-countdown">
                <div>
                  <strong>{daysToGoal}</strong>
                  <span>días de preparación</span>
                </div>
                <div className="goal-progress-track">
                  <span
                    style={{
                      width: `${Math.max(4, Math.min(100, Math.round((1 - daysToGoal / Math.max(1, data.plan?.weeks ? data.plan.weeks * 7 : daysToGoal)) * 100)))}%`,
                    }}
                  />
                </div>
              </div>
              {data.goal.targetTimeMin && (
                <div className="goal-target">
                  <Gauge size={15} />
                  Tiempo objetivo ·{" "}
                  {formatMinutes(Number(data.goal.targetTimeMin))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="goal-empty-copy">
                Una meta clara convierte la intención en un plan.
              </p>
              <button className="text-link" onClick={() => navigate("profile")}>
                Añadir objetivo <ArrowRight size={14} />
              </button>
            </>
          )}
        </section>
      </div>
      <div className="bottom-actions">
        <section className="coach-note">
          <div className="coach-note-icon">
            <HeartPulse size={18} />
          </div>
          <div>
            <strong>Entrena para mañana, no solo para hoy.</strong>
            <p>
              Registra también las sensaciones. El esfuerzo percibido nos ayuda
              a ajustar la carga con cabeza.
            </p>
          </div>
        </section>
        <button
          className="button button-outline reevaluate-button"
          disabled={busy || !data.activities.length || !data.plan}
          onClick={() =>
            void runAction(async () => {
              await api("/api/adaptation", { method: "POST", body: "{}" });
              await refresh();
            }, "Hemos preparado una propuesta para revisar.")
          }
        >
          Reevaluar mi plan
          <Sparkles size={15} />
        </button>
      </div>
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
  accent,
  progress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  accent: string;
  progress?: number;
}) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${accent}`}>{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-detail">{detail}</div>
      {progress !== undefined && (
        <div className="mini-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
    </article>
  );
}
function EmptyPlan({ onClick }: { onClick: () => void }) {
  return (
    <div className="empty-plan">
      <div className="empty-calendar">
        <CalendarDays size={23} />
      </div>
      <h4>Tu semana empieza aquí.</h4>
      <p>
        Completa el perfil y añade una carrera objetivo para generar tu primer
        plan.
      </p>
      <button className="button button-primary" onClick={onClick}>
        Crear mi plan <ArrowRight size={15} />
      </button>
    </div>
  );
}
function SessionIcon({ type }: { type: string }) {
  return type === "strength" ? (
    <Dumbbell size={17} />
  ) : type === "race" ? (
    <Target size={17} />
  ) : (
    <Footprints size={17} />
  );
}
function SessionPill({
  session,
  compact = false,
  onStatus,
  onReadiness,
  onOpenDetails,
  onUploadFit,
  fitBusy = false,
}: {
  session: Session;
  compact?: boolean;
  onStatus?: (status: "completed" | "skipped") => void;
  onReadiness?: (readiness: Record<string, boolean>) => void;
  onOpenDetails?: () => void;
  onUploadFit?: (file: File) => void;
  fitBusy?: boolean;
}) {
  const today = session.date === todayISO();
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [readiness, setReadiness] = useState<Record<string, boolean>>({});
  const readinessQuestions = [["poorSleep","Dormí mal"],["fatigueHigh","Fatiga superior a la habitual"],["stressHigh","Estrés elevado"],["muscleSorenessHigh","Agujetas importantes"],["localizedPain","Tengo dolor localizado"],["painWorsening","El dolor empeora al moverme"],["changesGait","El dolor altera mi marcha"],["illness","Fiebre o enfermedad"],["chestPain","Dolor torácico"],["dizziness","Mareo"],["unusualBreathlessness","Falta de aire inusual"]];
  return (
    <article
      className={`session-pill session-${session.type} ${today ? "is-today" : ""} ${session.status === "completed" ? "is-complete" : ""} ${session.status === "skipped" ? "is-skipped" : ""} ${compact ? "is-compact" : ""}`}
    >
      <button type="button" disabled={!onOpenDetails} className="session-date-block session-open-detail" onClick={onOpenDetails} title="Abrir detalle del entrenamiento" aria-label={`Ver entrenamiento ${session.title} del ${prettyDate(session.date)}`}>
        <span>{compact ? dayShort[(new Date(`${session.date}T12:00:00`).getDay() + 6) % 7] : prettyDate(session.date, { weekday: "short" })}</span>
        <strong>{new Date(`${session.date}T12:00:00`).getDate()}</strong>
      </button>
      <div className="session-icon">
        <SessionIcon type={session.type} />
      </div>
      <div className="session-info">
        <div className="session-title-row">
          <button type="button" disabled={!onOpenDetails} className="session-title-open" onClick={onOpenDetails}>{session.title}</button>
          {today && <span className="today-tag">HOY</span>}
          {session.status === "completed" && (
            <span className="completed-tag">
              <Check size={11} />
              COMPLETADA
            </span>
          )}
          {session.status === "skipped" && (
            <span className="skipped-tag">OMITIDA</span>
          )}
        </div>
        <span>
          {session.type === "strength"
            ? "Fuerza"
            : session.type === "race"
              ? "Competición"
              : "Carrera"}
          {session.phase && ` · ${session.phase}`}
        </span>
        {!compact && <p>{session.details}</p>}
      {session.safetyAction && <p className="session-safety-message">{session.safetyAction}</p>}
      </div>
      <div className="session-metrics">
        <strong>
          {session.distanceKm
            ? formatDistance(session.distanceKm)
            : formatMinutes(session.durationMin)}
        </strong>
        <span>
          {session.distanceKm
            ? formatMinutes(session.durationMin)
            : session.effort.split("·")[0].trim()}
        </span>
      </div>
      {(onStatus || onUploadFit || session.activityId) && (
        <div className="session-status-actions">
          {onUploadFit && !session.activityId && <label className={`session-fit-upload ${fitBusy ? "is-uploading" : ""}`} title="Adjuntar archivo FIT a esta sesión"><FileUp size={14} /><span>{fitBusy ? "Subiendo" : "FIT"}<input type="file" accept=".fit,application/octet-stream" disabled={fitBusy} onChange={(e) => { const file=e.currentTarget.files?.[0]; if(file) onUploadFit(file); e.currentTarget.value=""; }} /></span></label>}
          {session.activityId && <span className="session-fit-attached" title={session.activityFileName || "Archivo FIT asociado"}><Check size={11} /> FIT</span>}
          {onStatus && session.status === "pending" && <>
            {onReadiness && <button className="session-readiness" title="Evaluar cómo te encuentras antes de entrenar" onClick={() => setReadinessOpen(true)}><HeartPulse size={15} /></button>}
            <button className="session-complete" title="Marcar como completada" onClick={() => session.date >= todayISO() && (!session.readinessAt || new Date(session.readinessAt).toDateString() !== new Date().toDateString()) ? setReadinessOpen(true) : onStatus("completed")}><Check size={15} /></button>
            <button className="session-skip" title="Marcar como omitida" onClick={() => onStatus("skipped")}><X size={14} /></button>
          </>}
        </div>
      )}
      {readinessOpen && <div className="readiness-backdrop" role="presentation" onClick={() => setReadinessOpen(false)}><section className="panel readiness-dialog" role="dialog" aria-modal="true" aria-labelledby={`readiness-${session.id}`} onClick={(e) => e.stopPropagation()}><button className="icon-button readiness-close" aria-label="Cerrar" onClick={() => setReadinessOpen(false)}><X size={17} /></button><div className="eyebrow">ANTES DE ENTRENAR</div><h3 id={`readiness-${session.id}`}>¿Cómo te encuentras hoy?</h3><p>Marca lo que aplique. El sistema ajustará o cancelará la sesión según estas señales.</p><div className="strength-exercise-grid screening-grid">{readinessQuestions.map(([key,label]) => <label className="strength-exercise-option" key={key}><input type="checkbox" checked={Boolean(readiness[key])} onChange={() => setReadiness((current) => ({...current,[key]:!current[key]}))} />{label}</label>)}</div><div className="form-actions"><button className="button button-outline" onClick={() => setReadinessOpen(false)}>Volver</button><button className="button button-primary" onClick={() => { onReadiness?.(readiness); setReadinessOpen(false); setReadiness({}); }}>Evaluar y ajustar <HeartPulse size={15} /></button></div></section></div>}
    </article>
  );
}
function WeekPreview({ sessions }: { sessions: Session[] }) {
  const days = weekDates(todayISO());
  return (
    <div className="week-preview">
      {days.map((date, index) => {
        const items = sessions.filter((s) => s.date === date);
        const today = date === todayISO();
        return (
          <div
            className={`week-day ${today ? "week-day-today" : ""}`}
            key={date}
          >
            <span className="week-day-label">{dayShort[index]}</span>
            <span className="week-day-number">
              {new Date(`${date}T12:00:00`).getDate()}
            </span>
            {items.length ? (
              <span
                className={`week-day-marker marker-${items[0].type}`}
                title={items.map((item) => item.title).join(" · ")}
              >
                <SessionIcon type={items[0].type} />
                {items.length > 1 && <small>{items.length}</small>}
              </span>
            ) : (
              <span className="week-day-rest" />
            )}
          </div>
        );
      })}
      <div className="week-preview-list">
        {sessions.length ? (
          sessions.map((s) => <SessionPill key={s.id} session={s} compact />)
        ) : (
          <div className="rest-message">
            <span />
            No hay sesiones para estos días. Disfruta el descanso.
          </div>
        )}
      </div>
    </div>
  );
}

function PlanView({
  data,
  busy,
  runAction,
  refresh,
}: {
  data: AppData;
  busy: boolean;
  runAction: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
  refresh: () => Promise<void>;
}) {
  const [week, setWeek] = useState(1);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [fitUploadingId, setFitUploadingId] = useState<string | null>(null);
  const plan = data.plan;
  async function uploadSessionFit(session: Session, file: File) {
    setFitUploadingId(session.id);
    const result = await runAction(
      async () => api<{ ok: boolean; activityId: number }>(`/api/sessions/${encodeURIComponent(session.id)}/fit?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body: file,
        headers: { "Content-Type": "application/octet-stream" },
      }),
      "Archivo FIT asociado a la sesión y añadido al historial.",
    );
    setFitUploadingId(null);
    if (result) await refresh();
  }
  useEffect(() => {
    if (plan) setWeek(Math.min(Math.max(1, week), plan.weeks));
  }, [plan?.version, plan?.weeks]);
  if (!plan)
    return (
      <div className="panel setup-plan-panel">
        <div className="empty-calendar large">
          <CalendarDays size={27} />
        </div>
        <h2>Tu plan, hecho a tu medida.</h2>
        <p>
          Completa tu perfil y define una carrera objetivo. Prepararemos tu
          calendario de carrera y fuerza con progresión semanal.
        </p>
        <button
          className="button button-primary"
          onClick={() => window.dispatchEvent(new CustomEvent("open-profile"))}
        >
          Completar perfil y objetivo <ArrowRight size={15} />
        </button>
        <PlanTip />
      </div>
    );
  const sessions = plan.sessions.filter((s) => s.week === week);
  const selectedDates = weekDates(sessions[0]?.date || todayISO());
  const completedThisWeek = sessions.filter(
    (s) => s.status === "completed",
  ).length;
  const runKm = sessions
    .filter((s) => s.type === "run")
    .reduce((sum, s) => sum + (s.distanceKm || 0), 0);
  const runMinutes = sessions.filter((s) => s.type === "run").reduce((sum,s)=>sum+(s.durationMin||0),0);
  const phase = sessions[0]?.phase || "Recuperación";
  return (
    <>
      <div className="plan-summary-row">
        <div className="plan-phase-card">
          <span className="phase-orbit">
            <TrendingUp size={20} />
          </span>
          <div>
            <span>FASE DE ENTRENAMIENTO</span>
            <strong>{phase}</strong>
          </div>
          <span className="phase-step">
            SEMANA {week} / {plan.weeks}
          </span>
        </div>
        <div className="plan-summary-stat">
          <span>{plan.runningMetric === "distance" ? "CARRERA ESTA SEMANA" : "TIEMPO DE CARRERA"}</span>
          <strong>
            {plan.runningMetric === "distance" ? runKm.toLocaleString("es-ES", { maximumFractionDigits: 1 }) : runMinutes}{" "}
            <small>{plan.runningMetric === "distance" ? "km" : "min"}</small>
          </strong>
        </div>
        <div className="plan-summary-stat">
          <span>SESIONES COMPLETADAS</span>
          <strong>
            {completedThisWeek}
            <small> / {sessions.length}</small>
          </strong>
        </div>
      </div>
      {plan.changeReason && (
        <div className="plan-change-note">
          <RefreshCw size={16} />
          <div>
            <strong>
              Plan actualizado desde la versión {plan.previousVersion}.
            </strong>
            <span>{plan.changeReason}</span>
          </div>
        </div>
      )}
      <section className="panel algorithm-summary-panel">
        <div className="algorithm-summary-heading"><div><div className="eyebrow">MOTOR DETERMINISTA</div><strong>{plan.algorithmVersion || "RUN-HYBRID-1.0.0"} · reglas {plan.rulesetVersion || "2026.1"}</strong>{plan.rulesReviewed && <small className="rules-reviewed-label">Reglas revisadas · {plan.rulesReviewed}</small>}</div><span className="algorithm-level-pill">Nivel {plan.athleteLevel ?? "—"}</span></div>
        {plan.goalAssessment && <div className="goal-assessment"><strong>Objetivo: {plan.goalAssessment.classification}</strong>{plan.goalAssessment.predictedRangeMin && <span>Predicción orientativa para {formatDistance(plan.goal.distanceKm)} · {plan.goalAssessment.predictedRangeMin.lower}–{plan.goalAssessment.predictedRangeMin.upper} min</span>}{plan.goalAssessment.reasons.map((reason)=><p key={reason}>{reason}</p>)}{plan.goalAssessment.alternatives?.map((alternative)=><span className="goal-alternative" key={alternative}>{alternative}</span>)}</div>}
        {plan.warnings?.map((warning)=><p className="algorithm-warning" key={warning}><CircleHelp size={15}/>{warning}</p>)}
      </section>
      <section className="panel plan-load-panel"><div><div className="eyebrow">CARGA COMBINADA</div><strong>Estimación comparativa · no es una medición biomecánica</strong></div><div className="plan-load-metrics">{([['cardiovascular','Cardiovascular'],['impact','Impacto'],['neuromuscular','Neuromuscular'],['strength','Fuerza']] as const).map(([key,label])=><span key={key}><small>{label}</small><b>{sessions.reduce((sum,session)=>sum+Number(session.load?.[key]||0),0).toLocaleString("es-ES")}</b></span>)}</div></section>
      {data.planVersions.length > 1 && (
        <div className="version-history-strip">
          <History size={16} />
          <div>
            <strong>Historial del plan</strong>
            <span>{data.planVersions.length} versiones guardadas</span>
          </div>
          <div className="version-chips">
            {data.planVersions
              .slice()
              .reverse()
              .map((item) => (
                <span
                  className={item.version === plan.version ? "current" : ""}
                  key={item.version}
                >
                  v{item.version}
                </span>
              ))}
          </div>
          <small>
            Última actualización ·{" "}
            {new Date(plan.createdAt).toLocaleDateString("es-ES", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </small>
        </div>
      )}
      <section className="panel schedule-panel">
        <div className="schedule-top">
          <div>
            <div className="eyebrow">TU SEMANA, A SIMPLE VISTA</div>
            <h2>
              Semana {week}
              <span className="schedule-week-date">
                {sessions.length
                  ? `${prettyDate(sessions[0].date)} — ${prettyDate(sessions[sessions.length - 1].date, { day: "numeric", month: "short", year: "numeric" })}`
                  : ""}
              </span>
            </h2>
          </div>
          <div className="week-nav">
            <button
              className="icon-button"
              aria-label="Semana anterior"
              disabled={week <= 1}
              onClick={() => setWeek((n) => Math.max(1, n - 1))}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {String(week).padStart(2, "0")} <i>/</i>{" "}
              {String(plan.weeks).padStart(2, "0")}
            </span>
            <button
              className="icon-button"
              aria-label="Semana siguiente"
              disabled={week >= plan.weeks}
              onClick={() => setWeek((n) => Math.min(plan.weeks, n + 1))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <div className="schedule-strip">
          {selectedDates.map((date, index) => {
            const daySessions = sessions.filter((s) => s.date === date);
            const session = daySessions[0];
            const selected = date === todayISO();
            return (
              <button
                key={date}
                className={`schedule-day ${selected ? "selected" : ""} ${session ? `scheduled-${session.type}` : ""}`}
                onClick={() => {
                  if (session) {
                    setSelectedSession(session);
                    return;
                  }
                  const el = document.getElementById(`date-${date}`);
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                <span>{dayNames[index].slice(0, 3).toUpperCase()}</span>
                <strong>{new Date(`${date}T12:00:00`).getDate()}</strong>
                <i>
                  {session
                    ? daySessions.length > 1
                      ? `${daySessions.length} SESIONES`
                      : session.type === "strength"
                        ? "FUERZA"
                        : "CARRERA"
                    : "DESCANSO"}
                </i>
              </button>
            );
          })}
        </div>
        <div className="schedule-list">
          {selectedDates.map((date) => {
            const items = sessions.filter((s) => s.date === date);
            return (
              <div
                id={`date-${date}`}
                className="schedule-date-group"
                key={date}
              >
                <div className="schedule-date-label">
                  <strong>{prettyDate(date, { weekday: "long" })}</strong>
                  <span>
                    {prettyDate(date, { day: "numeric", month: "long" })}
                  </span>
                </div>
                {items.length ? (
                  items.map((item) => (
                    <SessionPill
                      key={item.id}
                      session={item}
                      onOpenDetails={() => setSelectedSession(item)}
                      onUploadFit={(file) => void uploadSessionFit(item, file)}
                      fitBusy={fitUploadingId === item.id}
                      onReadiness={(readiness) => void runAction(async () => {
                        await api(`/api/sessions/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify({ readiness }) });
                        await refresh();
                      }, "Preparación evaluada y sesión revisada.")}
                      onStatus={(status) =>
                        void runAction(
                          async () => {
                            await api(
                              `/api/sessions/${encodeURIComponent(item.id)}`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({ status }),
                              },
                            );
                            await refresh();
                          },
                          status === "completed"
                            ? "Sesión completada. ¡Buen trabajo!"
                            : "Sesión registrada como omitida.",
                        )
                      }
                    />
                  ))
                ) : (
                  <div className="rest-day-card">
                    <div className="rest-mark" />
                    <span>Descanso</span>
                    <small>Recuperar también es parte del entrenamiento.</small>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <div className="plan-notes-grid">
        <section className="panel plan-guidance">
          <div className="eyebrow">LA IDEA DE ESTA SEMANA</div>
          <h3>Progresar sin perder de vista la recuperación.</h3>
          <p>
            {phase === "Descarga"
              ? "Esta semana baja la carga y deja que el cuerpo asimile el trabajo. Mantén los rodajes relajados y llega fresco a la siguiente fase."
              : phase === "Específico"
                ? "El trabajo se acerca a las demandas de tu objetivo. Prioriza la sesión de calidad y mantén las tiradas largas a un esfuerzo cómodo."
                : phase === "Desarrollo"
                  ? "Construimos capacidad con una carga que sube poco a poco. En los intervalos, corre con control y termina sintiendo que podrías hacer una repetición más."
                  : "Consolidamos una base aeróbica y fuerza general. La mayoría de los kilómetros son cómodos; no hay prisa por acelerar."}
          </p>
        </section>
        <section className="panel plan-principles">
          <div className="eyebrow">GUÍA DEL PLAN</div>
          {plan.notes.map((note, i) => (
            <div className="principle-row" key={note}>
              <span>0{i + 1}</span>
              <p>{note}</p>
            </div>
          ))}
        </section>
      </div>
      {selectedSession && (() => {
        const session=plan.sessions.find((item)=>item.id===selectedSession.id) || selectedSession;
        return <div className="session-detail-backdrop" role="presentation" onClick={() => setSelectedSession(null)}><section className="panel session-detail-dialog" role="dialog" aria-modal="true" aria-labelledby={`session-detail-${session.id}`} onClick={(e)=>e.stopPropagation()}>
          <button className="icon-button session-detail-close" aria-label="Cerrar detalle" onClick={()=>setSelectedSession(null)}><X size={18}/></button>
          <div className="eyebrow">SEMANA {session.week} · {session.phase}</div>
          <h2 id={`session-detail-${session.id}`}>{session.title}</h2>
          <p className="session-detail-date">{prettyDate(session.date,{weekday:"long",day:"numeric",month:"long",year:"numeric"})} · {session.type==="strength"?"Fuerza":session.type==="race"?"Competición":"Carrera"}</p>
          <div className="session-detail-stats"><span><small>DURACIÓN</small><strong>{formatMinutes(session.durationMin)}</strong></span><span><small>DISTANCIA</small><strong>{formatDistance(session.distanceKm)}</strong></span><span><small>ESFUERZO</small><strong>{session.effort}</strong></span><span><small>ESTADO</small><strong>{session.status==="completed"?"Completada":session.status==="skipped"?"Omitida":"Pendiente"}</strong></span></div>
          <div className="session-detail-description">{session.details}</div>
          {session.safetyAction && <p className="session-safety-message">{session.safetyAction}</p>}
          {session.activityId && <p className="session-fit-confirmation"><Check size={15}/> FIT asociado: {session.activityFileName || "archivo cargado"}{session.activityDate?` · actividad del ${prettyDate(session.activityDate)}`:""}. También está en tu historial.</p>}
          <div className="session-detail-actions">
            {!session.activityId && <label className={`button button-outline ${fitUploadingId===session.id?"is-uploading":""}`}><FileUp size={15}/>{fitUploadingId===session.id?"Subiendo FIT…":"Adjuntar archivo FIT"}<input type="file" accept=".fit,application/octet-stream" disabled={fitUploadingId===session.id} onChange={(e)=>{const file=e.currentTarget.files?.[0];if(file)void uploadSessionFit(session,file);e.currentTarget.value="";}}/></label>}
            <button className="button button-primary" onClick={()=>setSelectedSession(null)}>Cerrar</button>
          </div>
        </section></div>;
      })()}
      <PlanTip />
      <details className="decision-log"><summary>Registro de decisiones · {plan.decisions?.length || 0} reglas</summary>{plan.decisions?.map((decision,index)=><div className="decision-log-row" key={`${decision.ruleId}-${index}`}><strong>{decision.code}</strong><small>{decision.ruleId}</small><p>{decision.reason}</p></div>)}</details>
    </>
  );
}
function PlanTip() {
  return (
    <div className="safety-note">
      <HeartPulse size={16} />
      <span>
        Usa el esfuerzo percibido como guía. Si sientes dolor persistente o
        inusual, para la sesión y busca consejo profesional.
      </span>
    </div>
  );
}

function HistoryView({
  data,
  busy,
  runAction,
  refresh,
  onOpenActivity,
}: {
  data: AppData;
  busy: boolean;
  runAction: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
  refresh: () => Promise<void>;
  onOpenActivity: (activityId: number) => void;
}) {
  const [preview, setPreview] = useState<ActivityLog | null>(null);
  const [dragOver, setDragOver] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    setPreview(null);
    const result = await runAction(
      async () =>
        api<{ preview: ActivityLog }>(
          `/api/activities/import?filename=${encodeURIComponent(file.name)}`,
          {
            method: "POST",
            body: file,
            headers: { "Content-Type": "application/octet-stream" },
          },
        ),
      "Archivo analizado. Revisa y completa los datos antes de guardar.",
    );
    if (result) setPreview(result.preview);
  }
  async function saveActivity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      ...preview,
      rpe: form.get("rpe"),
      soreness: form.get("soreness"),
      painWorsening: form.has("painWorsening"),
      painChangesGait: form.has("painChangesGait"),
      illness: form.has("illness"),
      poorSleep: form.has("poorSleep"),
      fatigueHigh: form.has("fatigueHigh"),
      note: form.get("note"),
    };
    const result = await runAction(
      async () =>
        api("/api/activities", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      "Actividad añadida a tu historial.",
    );
    if (result) {
      setPreview(null);
      await refresh();
    }
  }
  const sourceCount = data.activities.filter((a) => a.source).length;
  return (
    <>
      <section className="panel import-panel">
        <div className="import-copy">
          <div className="eyebrow">AÑADE UNA ACTIVIDAD</div>
          <h2>Tu esfuerzo también cuenta.</h2>
          <p>
            Importa un archivo FIT o GPX y añade cómo te sentiste. Aceptamos
            archivos de hasta 40 MB.
          </p>
          <div className="format-tags">
            <span>
              .FIT <small>Frecuencia cardiaca y más</small>
            </span>
            <span>
              .GPX <small>Ruta y distancia</small>
            </span>
          </div>
        </div>
        <label
          className={`upload-dropzone ${dragOver ? "drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void upload(e.dataTransfer.files[0]);
          }}
        >
          <input
            type="file"
            accept=".fit,.gpx,application/octet-stream,application/gpx+xml"
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <div className="upload-cloud">
            <Upload size={21} />
          </div>
          <strong>Suelta tu archivo aquí</strong>
          <span>o haz clic para buscar</span>
          <small>FIT · GPX</small>
        </label>
      </section>
      {preview && (
        <section className="panel activity-preview-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">VISTA PREVIA · {preview.filename}</div>
              <h3>Revisa tu actividad</h3>
            </div>
            <button
              className="icon-button"
              aria-label="Descartar archivo"
              onClick={() => setPreview(null)}
            >
              <X size={17} />
            </button>
          </div>
          <div className="preview-stats">
            <div>
              <span>FECHA</span>
              <strong>
                {prettyDate(preview.date, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </strong>
            </div>
            <div>
              <span>DISTANCIA</span>
              <strong>{formatDistance(preview.distanceKm)}</strong>
            </div>
            <div>
              <span>DURACIÓN</span>
              <strong>{formatMinutes(preview.durationMin)}</strong>
            </div>
            <div>
              <span>FC MEDIA</span>
              <strong>
                {preview.avgHeartRate ? `${preview.avgHeartRate} bpm` : "—"}
              </strong>
            </div>
          </div>
          <form onSubmit={(e) => void saveActivity(e)}>
            <div className="form-grid two-col">
              <Field label="Esfuerzo percibido (RPE)">
                <select name="rpe" defaultValue="">
                  <option value="">Sin valorar</option>
                  {Array.from({ length: 10 }, (_, i) => (
                    <option value={i + 1} key={i + 1}>
                      {i + 1} / 10
                      {
                        [
                          " · muy suave",
                          " · suave",
                          " · fácil",
                          " · moderado",
                          " · moderado",
                          " · algo duro",
                          " · duro",
                          " · muy duro",
                          " · casi máximo",
                          " · máximo",
                        ][i]
                      }
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="¿Molestias o dolor?">
                <select name="soreness" defaultValue="">
                  <option value="">No, todo bien</option>
                  <option value="Leve">Sí, leve</option>
                  <option value="Moderada">Sí, moderada</option>
                  <option value="Intensa">Sí, intensa</option>
                </select>
              </Field>
              <div className="strength-exercise-grid screening-grid activity-readiness-fields">
                <label className="strength-exercise-option"><input type="checkbox" name="painWorsening" />El dolor empeoró durante la actividad</label>
                <label className="strength-exercise-option"><input type="checkbox" name="painChangesGait" />El dolor alteró mi marcha o técnica</label>
                <label className="strength-exercise-option"><input type="checkbox" name="illness" />Tuve fiebre o enfermedad</label>
                <label className="strength-exercise-option"><input type="checkbox" name="poorSleep" />Dormí mal</label>
                <label className="strength-exercise-option"><input type="checkbox" name="fatigueHigh" />Fatiga superior a la habitual</label>
              </div>
              <Field label="Notas de sensaciones" full>
                <textarea
                  name="note"
                  defaultValue={preview.note}
                  rows={2}
                  placeholder="¿Cómo te encontraste? ¿Algo que quieras recordar?"
                />
              </Field>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setPreview(null)}
              >
                Cancelar
              </button>
              <button className="button button-primary" disabled={busy}>
                Guardar actividad <Save size={15} />
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="panel activity-history-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">TU RECORRIDO</div>
            <h3>Historial de actividad</h3>
          </div>
          <span className="count-pill">
            {data.activities.length}{" "}
            {data.activities.length === 1 ? "registro" : "registros"}
          </span>
        </div>
        {data.activities.length ? (
          <div className="activity-table">
            <div className="activity-table-header">
              <span>ACTIVIDAD</span>
              <span>FECHA</span>
              <span>DISTANCIA</span>
              <span>DURACIÓN</span>
              <span>ESFUERZO</span>
            </div>
            {data.activities.map((a, i) => (
              <button
                type="button"
                className="activity-row activity-row-clickable"
                key={a.id || a.fileHash || i}
                onClick={() => a.id && onOpenActivity(a.id)}
                aria-label={`Abrir detalle de ${a.source || "actividad"} del ${a.date}`}
              >
                <div className="activity-name">
                  <div
                    className={`activity-type-icon ${a.type === "strength" ? "icon-strength" : ""}`}
                  >
                    {a.type === "strength" ? (
                      <Dumbbell size={17} />
                    ) : a.type === "other" ? (
                      <Activity size={17} />
                    ) : (
                      <Footprints size={17} />
                    )}
                  </div>
                  <div>
                    <strong>
                      {a.sessionName || (a.type === "strength"
                        ? "Entrenamiento de fuerza"
                        : a.type === "other"
                          ? "Otra actividad"
                          : a.source
                            ? `Carrera · ${a.source}`
                            : "Carrera")}
                    </strong>
                    {a.source?.toUpperCase() === "FIT" && (
                      <span className="activity-view-badge">
                        Ver todos los datos <ChevronRight size={13} />
                      </span>
                    )}
                    <span>
                      {a.soreness
                        ? `Molestias · ${a.soreness.toLowerCase()}`
                        : a.note || "Actividad registrada"}
                    </span>
                  </div>
                </div>
                <span className="activity-date">
                  {prettyDate(a.date, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <strong className="activity-distance">
                  {formatDistance(a.distanceKm)}
                </strong>
                <span className="activity-duration">
                  {formatMinutes(a.durationMin)}
                </span>
                <span className="activity-rpe">
                  {a.rpe ? (
                    <>
                      <i>{a.rpe}</i> / 10
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-history">
            <div className="empty-calendar">
              <History size={21} />
            </div>
            <h4>Aquí empieza tu historia.</h4>
            <p>
              Importa un archivo de actividad para ver cómo progresa tu
              entrenamiento. Cada esfuerzo cuenta.
            </p>
          </div>
        )}
      </section>
      <div className="history-footnote">
        <HeartPulse size={15} />
        <span>
          RPE (esfuerzo percibido) y molestias nos ayudan a ajustar el plan a
          cómo te encuentras, no solo a los números.
        </span>
        <span className="history-import-count">
          <FileUp size={14} />
          {sourceCount} importadas
        </span>
      </div>
    </>
  );
}

type FitRecord = Record<string, unknown>;
type ChartPoint = { x: number; y: number };

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fitObjects(value: unknown): FitRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is FitRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function fitValue(object: FitRecord | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function formatPace(minutesPerKm: number | null) {
  if (!minutesPerKm || !Number.isFinite(minutesPerKm)) return "—";
  const totalSeconds = Math.round(minutesPerKm * 60);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function paceFromSpeed(speed: unknown) {
  const kmh = finiteNumber(speed);
  return kmh && kmh > 0 ? 60 / kmh : null;
}

function fitLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatFitValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number")
    return Number.isInteger(value)
      ? String(value)
      : value.toLocaleString("es-ES", { maximumFractionDigits: 3 });
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(formatFitValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ActivityDetailView({
  activityId,
  onBack,
}: {
  activityId: number;
  onBack: () => void;
}) {
  const [activity, setActivity] = useState<ActivityLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError("");
    api<ActivityLog>(`/api/activities/${activityId}`)
      .then((result) => {
        if (live) setActivity(result);
      })
      .catch((error: unknown) => {
        if (live)
          setLoadError(
            error instanceof Error
              ? error.message
              : "No se pudo cargar el detalle de esta actividad.",
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [activityId]);

  if (loading)
    return (
      <div className="panel activity-detail-loading">
        <div className="brand-mark">R</div>
        <p>Cargando todos los datos de la actividad…</p>
      </div>
    );
  if (loadError || !activity)
    return (
      <section className="panel activity-detail-error">
        <button className="button button-outline" onClick={onBack}>
          <ArrowLeft size={15} /> Volver al historial
        </button>
        <p>{loadError || "No se encontró esta actividad."}</p>
      </section>
    );

  const fit = activity.fitData;
  const fitSessions = fitObjects(fit?.sessions);
  const session = fitSessions.at(-1);
  const records = fitObjects(fit?.records);
  const laps = fitObjects(fit?.laps);
  const usesDistance = records.some(
    (record) => finiteNumber(record.distance) !== null,
  );
  let lastDistance: number | null = null;
  let lastElapsed: number | null = null;
  const recordRows = records.map((record, index) => {
    const currentDistance = finiteNumber(record.distance);
    const currentElapsed =
      finiteNumber(record.elapsed_time) ??
      finiteNumber(record.timer_time) ??
      (record.timestamp ? Date.parse(String(record.timestamp)) / 1000 : null);
    let speed =
      finiteNumber(record.enhanced_speed) ?? finiteNumber(record.speed);
    if (
      (!speed || speed <= 0) &&
      currentDistance !== null &&
      lastDistance !== null &&
      currentElapsed !== null &&
      lastElapsed !== null &&
      currentElapsed > lastElapsed
    )
      speed =
        ((currentDistance - lastDistance) * 3600) /
        (currentElapsed - lastElapsed);
    if (currentDistance !== null) lastDistance = currentDistance;
    if (currentElapsed !== null) lastElapsed = currentElapsed;
    const x = usesDistance
      ? currentDistance
      : currentElapsed !== null
        ? currentElapsed / 60
        : index;
    return { record, x: x ?? index, speed };
  });
  const series = (field: string, alias?: string): ChartPoint[] =>
    recordRows.flatMap(({ record, x }) => {
      const value =
        finiteNumber(record[field]) ??
        (alias ? finiteNumber(record[alias]) : null);
      return value === null ? [] : [{ x, y: value }];
    });
  const paceSeries = recordRows.flatMap(({ x, speed }) => {
    const pace = paceFromSpeed(speed);
    return pace && pace > 1.5 && pace < 35 ? [{ x, y: pace }] : [];
  });
  const heartSeries = series("heart_rate", "enhanced_heart_rate");
  const altitudeSeries = series("enhanced_altitude", "altitude").map(
    (point) => ({
      ...point,
      y: point.y * 1000,
    }),
  );
  const powerSeries = series("power", "enhanced_power");
  const cadenceSeries = series("cadence", "fractional_cadence");
  const rawDataJson = fit ? JSON.stringify(fit, null, 2) : "";
  const averageSpeed = finiteNumber(
    fitValue(session, "enhanced_avg_speed", "avg_speed"),
  );
  const averagePace = paceFromSpeed(averageSpeed);
  const ascentKm = finiteNumber(fitValue(session, "total_ascent"));
  const sport = fitValue(session, "sport", "sub_sport", "name");
  const dateLabel = prettyDate(activity.date, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const metrics: { label: string; value: string; detail?: string }[] = [
    { label: "DISTANCIA", value: formatDistance(activity.distanceKm) },
    { label: "DURACIÓN", value: formatMinutes(activity.durationMin) },
    {
      label: "RITMO MEDIO",
      value: averagePace ? `${formatPace(averagePace)} /km` : "—",
    },
    {
      label: "FC MEDIA",
      value: activity.avgHeartRate ? `${activity.avgHeartRate} bpm` : "—",
    },
    {
      label: "FC MÁXIMA",
      value: activity.maxHeartRate ? `${activity.maxHeartRate} bpm` : "—",
    },
    {
      label: "CALORÍAS",
      value: formatFitValue(fitValue(session, "total_calories", "calories")),
    },
    {
      label: "ASCENSO",
      value:
        ascentKm !== null
          ? `${Math.round(ascentKm * 1000).toLocaleString("es-ES")} m`
          : "—",
    },
    {
      label: "CADENCIA MEDIA",
      value:
        fitValue(session, "avg_cadence") !== null
          ? `${formatFitValue(fitValue(session, "avg_cadence"))} pasos/min`
          : "—",
    },
    {
      label: "POTENCIA MEDIA",
      value:
        fitValue(session, "avg_power") !== null
          ? `${formatFitValue(fitValue(session, "avg_power"))} W`
          : "—",
    },
    { label: "RPE", value: activity.rpe ? `${activity.rpe} / 10` : "—" },
  ];

  return (
    <div className="activity-detail-page">
      <button
        className="button button-outline activity-back-button"
        onClick={onBack}
      >
        <ArrowLeft size={15} /> Volver al historial
      </button>
      <section className="panel activity-detail-hero">
        <div className="activity-detail-icon">
          <Footprints size={22} />
        </div>
        <div className="activity-detail-title">
          <div className="eyebrow">
            DETALLE COMPLETO · {activity.source || "ACTIVIDAD"}
          </div>
          <h2>{activity.sessionName || activity.filename || "Actividad"}</h2>
          <p>
            {dateLabel}
            {sport ? ` · ${fitLabel(String(sport))}` : ""}
          </p>
        </div>
        <span className="activity-detail-record-count">
          {records.length
            ? `${records.length.toLocaleString("es-ES")} registros`
            : "Resumen"}
        </span>
      </section>

      {activity.source?.toUpperCase() === "FIT" && !fit && (
        <div className="activity-fit-legacy-note">
          <CircleHelp size={17} />
          <span>
            Esta actividad se importó antes de guardar el detalle completo del
            FIT. Vuelve a importar el archivo original para completar sus datos;
            se actualizará este registro existente.
          </span>
        </div>
      )}

      <section className="activity-detail-metrics">
        {metrics.map((metric) => (
          <article className="panel activity-metric-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </section>

      {paceSeries.length > 1 ||
      heartSeries.length > 1 ||
      altitudeSeries.length > 1 ||
      powerSeries.length > 1 ||
      cadenceSeries.length > 1 ? (
        <section className="activity-chart-grid">
          {paceSeries.length > 1 && (
            <ActivityChart
              title="Ritmo"
              unit="min/km"
              color="#4f8968"
              points={paceSeries}
              xLabel={usesDistance ? "Distancia (km)" : "Tiempo (min)"}
              formatter={(value) => formatPace(value)}
              lowerIsBetter
            />
          )}
          {heartSeries.length > 1 && (
            <ActivityChart
              title="Frecuencia cardiaca"
              unit="bpm"
              color="#d97766"
              points={heartSeries}
              xLabel={usesDistance ? "Distancia (km)" : "Tiempo (min)"}
            />
          )}
          {altitudeSeries.length > 1 && (
            <ActivityChart
              title="Altitud"
              unit="m"
              color="#7185ad"
              points={altitudeSeries}
              xLabel={usesDistance ? "Distancia (km)" : "Tiempo (min)"}
            />
          )}
          {powerSeries.length > 1 && (
            <ActivityChart
              title="Potencia"
              unit="W"
              color="#bb8b45"
              points={powerSeries}
              xLabel={usesDistance ? "Distancia (km)" : "Tiempo (min)"}
            />
          )}
          {cadenceSeries.length > 1 && (
            <ActivityChart
              title="Cadencia"
              unit="pasos/min"
              color="#906ca4"
              points={cadenceSeries}
              xLabel={usesDistance ? "Distancia (km)" : "Tiempo (min)"}
            />
          )}
        </section>
      ) : fit ? (
        <section className="panel activity-no-charts">
          <Gauge size={19} />
          <span>
            Este archivo no incluye suficientes registros temporales para
            dibujar gráficas.
          </span>
        </section>
      ) : null}

      {activity.note && (
        <section className="panel activity-athlete-note">
          <strong>Notas y sensaciones</strong>
          <p>{activity.note}</p>
          {activity.soreness && <span>Molestias: {activity.soreness}</span>}
        </section>
      )}

      {laps.length > 0 && (
        <section className="panel activity-laps-panel">
          <div className="activity-section-heading">
            <div>
              <div className="eyebrow">DESGLOSE</div>
              <h3>Vueltas · {laps.length}</h3>
            </div>
          </div>
          <div className="activity-laps-list">
            {laps.map((lap, index) => (
              <article className="activity-lap-row" key={index}>
                <strong>Vuelta {index + 1}</strong>
                <span>{formatDistance(finiteNumber(lap.total_distance))}</span>
                <span>
                  {formatMinutes(
                    Math.round(
                      (finiteNumber(lap.total_elapsed_time) || 0) / 60,
                    ) || null,
                  )}
                </span>
                <span>
                  {finiteNumber(lap.avg_heart_rate)
                    ? `${lap.avg_heart_rate} bpm`
                    : "—"}
                </span>
                <details>
                  <summary>Campos de la vuelta</summary>
                  <FitFieldList value={lap} />
                </details>
              </article>
            ))}
          </div>
        </section>
      )}

      {fit && (
        <FullFitDisclosure
          data={fit}
          recordCount={records.length}
          rawDataJson={rawDataJson}
        />
      )}
    </div>
  );
}

function ActivityChart({
  title,
  unit,
  color,
  points,
  xLabel,
  formatter,
  lowerIsBetter = false,
}: {
  title: string;
  unit: string;
  color: string;
  points: ChartPoint[];
  xLabel: string;
  formatter?: (value: number) => string;
  lowerIsBetter?: boolean;
}) {
  const width = 800;
  const height = 250;
  const left = 62;
  const right = 22;
  const top = 20;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const xMin = Math.min(...points.map((point) => point.x));
  const xMax = Math.max(...points.map((point) => point.x));
  const yMin = Math.min(...points.map((point) => point.y));
  const yMax = Math.max(...points.map((point) => point.y));
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || Math.max(1, Math.abs(yMin) * 0.1);
  const coordinates = points
    .map((point) => {
      const x = left + ((point.x - xMin) / xRange) * plotWidth;
      const fraction = (point.y - yMin) / yRange;
      const y = lowerIsBetter
        ? top + fraction * plotHeight
        : top + (1 - fraction) * plotHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const format =
    formatter || ((value: number) => Math.round(value).toLocaleString("es-ES"));
  return (
    <section className="panel activity-chart-card">
      <div className="activity-section-heading">
        <div>
          <div className="eyebrow">EVOLUCIÓN</div>
          <h3>{title}</h3>
        </div>
        <span>{unit}</span>
      </div>
      <svg
        className="activity-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Gráfica de ${title}`}
        preserveAspectRatio="none"
      >
        {[0, 0.5, 1].map((fraction) => {
          const y = top + fraction * plotHeight;
          const valueFraction = lowerIsBetter ? fraction : 1 - fraction;
          const value = yMin + valueFraction * yRange;
          return (
            <g key={fraction}>
              <line
                x1={left}
                y1={y}
                x2={width - right}
                y2={y}
                className="chart-grid-line"
              />
              <text
                x={left - 9}
                y={y + 4}
                textAnchor="end"
                className="chart-axis-label"
              >
                {format(value)}
              </text>
            </g>
          );
        })}
        <polyline
          points={coordinates}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <text x={left} y={height - 11} className="chart-axis-label">
          {xMin.toLocaleString("es-ES", { maximumFractionDigits: 1 })}
        </text>
        <text
          x={width - right}
          y={height - 11}
          textAnchor="end"
          className="chart-axis-label"
        >
          {xMax.toLocaleString("es-ES", { maximumFractionDigits: 1 })}
        </text>
      </svg>
      <div className="chart-x-axis">{xLabel}</div>
    </section>
  );
}

function FitFieldList({ value }: { value: FitRecord }) {
  return (
    <dl className="fit-field-list">
      {Object.entries(value).map(([key, item]) => (
        <div key={key}>
          <dt>{fitLabel(key)}</dt>
          <dd>{formatFitValue(item)}</dd>
        </div>
      ))}
    </dl>
  );
}

function FullFitDisclosure({
  data,
  recordCount,
  rawDataJson,
}: {
  data: Record<string, unknown>;
  recordCount: number;
  rawDataJson: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="panel activity-all-data-panel">
      <div className="activity-section-heading">
        <div>
          <div className="eyebrow">ARCHIVO ORIGINAL INTERPRETADO</div>
          <h3>Todos los datos FIT</h3>
          <p>
            Incluye todas las sesiones, vueltas, puntos de registro, mensajes
            reconocidos y campos sin mapear que contenía el archivo.
          </p>
        </div>
      </div>
      <button
        className="button button-outline"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded
          ? "Ocultar datos técnicos"
          : `Mostrar todos los datos · ${recordCount.toLocaleString("es-ES")} registros`}
        <ChevronDown size={15} />
      </button>
      {expanded && (
        <pre className="activity-full-fit-json">
          {rawDataJson || JSON.stringify(data, null, 2)}
        </pre>
      )}
    </section>
  );
}

function Field({
  label,
  children,
  hint,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  full?: boolean;
}) {
  return (
    <label className={`field ${full ? "field-full" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function ProfileView({
  current,
  goal,
  busy,
  runAction,
  refresh,
}: {
  current: Profile | null;
  goal: Goal | null;
  busy: boolean;
  runAction: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState<Profile>(() => normalizedProfile(current));
  const [goalForm, setGoalForm] = useState<Goal>({ distanceKm: 5, raceDate: "", targetTimeMin: "", priority: "finish_healthy", terrain: "road", elevationGainM: "" });
  useEffect(() => {
    setForm(normalizedProfile(current));
  }, [current]);
  useEffect(() => {
    if (goal) setGoalForm({ ...goal, distanceKm: goal.distanceKm === 21.1 ? 21.097 : goal.distanceKm, priority: goal.priority || "finish_healthy", terrain: goal.terrain || "road", targetTimeMin: goal.targetTimeMin ?? "" });
  }, [goal]);
  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    const res = await runAction(async () => {
      await api("/api/profile", { method: "PUT", body: JSON.stringify(form) });
      await refresh();
    }, "Perfil guardado.");
    return res;
  }
  async function saveGoal(event: React.FormEvent) {
    event.preventDefault();
    if (!goalForm.raceDate) return;
    const res = await runAction(async () => {
      await api("/api/goal", { method: "PUT", body: JSON.stringify(goalForm) });
      await refresh();
    }, "Objetivo actualizado.");
    return res;
  }
  async function generate() {
    await runAction(async () => {
      await api("/api/profile", { method: "PUT", body: JSON.stringify(form) });
      await api("/api/goal", { method: "PUT", body: JSON.stringify(goalForm) });
      await api("/api/plans/generate", { method: "POST", body: "{}" });
      await refresh();
    }, "Tu nuevo plan ya está listo.");
  }
  useEffect(() => {
    const handler = () =>
      document
        .getElementById("profile-top")
        ?.scrollIntoView({ behavior: "smooth" });
    window.addEventListener("open-profile", handler);
    return () => window.removeEventListener("open-profile", handler);
  }, []);
  const toggleTraining = (dayIndex: number, field: Exclude<keyof DayTraining, "maxSessionMinutes">) =>
    setForm((currentForm) => {
      const trainingSchedule = currentForm.trainingSchedule.map(
        (day, index) => {
          if (index !== dayIndex)
            return field === "longRun" && !day.street
              ? { ...day, longRun: false }
              : day;
          const next = { ...day, [field]: !day[field] };
          if (field === "street" && !next.street) next.longRun = false;
          return next;
        },
      );
      if (
        field === "longRun" &&
        !currentForm.trainingSchedule[dayIndex].longRun
      )
        trainingSchedule.forEach((day, index) => {
          if (index !== dayIndex) day.longRun = false;
        });
      return { ...currentForm, trainingSchedule };
    });
  const update = (key: keyof Profile, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const toggleScreening = (group: "healthScreening" | "precautionScreening", key: string) =>
    setForm((current) => ({ ...current, [group]: { ...current[group], [key]: !current[group][key] } }));
  return (
    <div className="profile-layout" id="profile-top">
      <div className="profile-main-column">
        <section className="panel profile-form-panel">
          <div className="form-section-heading">
            <span className="section-icon">
              <UserRound size={18} />
            </span>
            <div>
              <h3>Sobre ti</h3>
              <p>Solo lo que ayuda a adaptar el entrenamiento.</p>
            </div>
            <span className="optional-badge">PRIVADO</span>
          </div>
          <form id="profile-form" onSubmit={(e) => void saveProfile(e)}>
            <div className="form-grid three-col">
              <Field label="Nombre o apodo">
                <input
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="¿Cómo te llamamos?"
                />
              </Field>
              <Field label="Edad">
                <div className="input-unit">
                  <input
                    type="number"
                    min="14"
                    max="100"
                    value={form.age}
                    onChange={(e) => update("age", e.target.value)}
                    placeholder="—"
                  />
                  <span>años</span>
                </div>
              </Field>
              <Field label="Experiencia">
                <select
                  value={form.experience}
                  onChange={(e) => update("experience", e.target.value)}
                >
                  <option value="principiante">Principiante</option>
                  <option value="intermedio">Intermedio</option>
                  <option value="avanzado">Avanzado</option>
                </select>
              </Field>
              <Field label="Peso (opcional)">
                <div className="input-unit">
                  <input
                    type="number"
                    min="30"
                    max="250"
                    step="0.1"
                    value={form.weightKg}
                    onChange={(e) => update("weightKg", e.target.value)}
                    placeholder="—"
                  />
                  <span>kg</span>
                </div>
              </Field>
              <Field label="Altura (opcional)">
                <div className="input-unit">
                  <input
                    type="number"
                    min="120"
                    max="230"
                    value={form.heightCm}
                    onChange={(e) => update("heightCm", e.target.value)}
                    placeholder="—"
                  />
                  <span>cm</span>
                </div>
              </Field>
            </div>
          </form>
        </section>
        <section className="panel profile-form-panel">
          <div className="form-section-heading">
            <span className="section-icon section-icon-run">
              <Footprints size={18} />
            </span>
            <div>
              <h3>Tu punto de partida</h3>
              <p>Cuéntanos de dónde vienes, no adónde tienes que llegar.</p>
            </div>
          </div>
          <div className="form-grid three-col">
            <Field
              label="Kilómetros por semana"
              hint="Media aproximada del último mes"
            >
              <div className="input-unit">
                <input
                  form="profile-form"
                  type="number"
                  min="0"
                  max="250"
                  step="0.5"
                  value={form.weeklyKm}
                  onChange={(e) => update("weeklyKm", e.target.value)}
                />
                <span>km</span>
              </div>
            </Field>
            <Field label="Tirada más larga reciente">
              <div className="input-unit">
                <input
                  form="profile-form"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={form.longestRunKm}
                  onChange={(e) => update("longestRunKm", e.target.value)}
                />
                <span>km</span>
              </div>
            </Field>
            <Field label="Marca 5K reciente (opcional)">
              <div className="input-unit">
                <input
                  form="profile-form"
                  type="number"
                  min="10"
                  max="120"
                  step="0.1"
                  value={form.recent5kMin}
                  onChange={(e) => update("recent5kMin", e.target.value)}
                  placeholder="—"
                />
                <span>min</span>
              </div>
            </Field>
            <Field label="Fecha de esa marca"><input form="profile-form" type="date" max={todayISO()} value={form.recent5kDate} onChange={(e) => update("recent5kDate", e.target.value)} /></Field>
          </div>
          <div className="subsection-label">Carga y tolerancia reciente <span>Las últimas cuatro semanas guían el nivel</span></div>
          <div className="form-grid three-col">
            <Field label="Sesiones de carrera por semana"><input form="profile-form" type="number" min="0" max="14" value={form.currentWeeklyRuns} onChange={(e) => update("currentWeeklyRuns", e.target.value)} /></Field>
            <Field label="Minutos corriendo por semana"><input form="profile-form" type="number" min="0" max="1200" value={form.currentWeeklyMinutes} onChange={(e) => update("currentWeeklyMinutes", e.target.value)} /></Field>
            <Field label="Tirada más larga · minutos"><input form="profile-form" type="number" min="0" max="600" value={form.longestRunMinutes} onChange={(e) => update("longestRunMinutes", e.target.value)} /></Field>
            <Field label="Carrera continua cómoda · minutos"><input form="profile-form" type="number" min="0" max="300" value={form.continuousRunMinutes} onChange={(e) => update("continuousRunMinutes", e.target.value)} /></Field>
            <Field label="Meses de experiencia corriendo"><input form="profile-form" type="number" min="0" max="600" value={form.runningExperienceMonths} onChange={(e) => update("runningExperienceMonths", e.target.value)} /></Field>
            <Field label="Meses de experiencia de fuerza"><input form="profile-form" type="number" min="0" max="600" value={form.strengthExperienceMonths} onChange={(e) => update("strengthExperienceMonths", e.target.value)} /></Field>
            <Field label="Semanas desde el último entrenamiento"><input form="profile-form" type="number" min="0" max="104" value={form.weeksSinceTraining} onChange={(e) => update("weeksSinceTraining", e.target.value)} /></Field>
            <Field label="Máximo por sesión · minutos"><input form="profile-form" type="number" min="15" max="300" value={form.maxSessionMinutes} onChange={(e) => update("maxSessionMinutes", e.target.value)} /></Field>
            <Field label="Métrica preferida"><select form="profile-form" value={form.preferredRunningMetric} onChange={(e) => update("preferredRunningMetric", e.target.value)}><option value="time">Tiempo y RPE</option><option value="distance">Distancia y ritmo</option></select></Field>
            <Field label="Prioridad entrenamiento"><select form="profile-form" value={form.trainingPriority} onChange={(e) => update("trainingPriority", e.target.value)}><option value="balanced">Equilibrada</option><option value="running">Carrera</option><option value="strength">Fuerza</option></select></Field>
            <label className="strength-exercise-option"><input form="profile-form" type="checkbox" checked={form.gymAccess} onChange={(e) => setForm((v) => ({...v,gymAccess:e.target.checked}))} />Tengo acceso a gimnasio</label>
          </div>
          <div className="strength-exercise-grid screening-grid">
            <label className="strength-exercise-option"><input form="profile-form" type="checkbox" checked={form.canWalk30Minutes} onChange={(e) => setForm((v) => ({ ...v, canWalk30Minutes: e.target.checked }))} />Puedo caminar 30 minutos sin síntomas</label>
            <label className="strength-exercise-option"><input form="profile-form" type="checkbox" checked={form.painWhileWalking} onChange={(e) => setForm((v) => ({ ...v, painWhileWalking: e.target.checked }))} />Tengo dolor al caminar</label>
          </div>
          <div className="subsection-label">Recuperación habitual <span>Señales complementarias; no se requiere pulsómetro</span></div>
          <div className="form-grid three-col">
            <Field label="Horas de sueño"><input form="profile-form" type="number" min="0" max="24" step="0.5" value={form.recoveryProfile.sleepHours} onChange={(e) => setForm((v) => ({ ...v, recoveryProfile: { ...v.recoveryProfile, sleepHours: e.target.value } }))} /></Field>
            <Field label="Calidad de sueño · 1–5"><input form="profile-form" type="number" min="1" max="5" value={form.recoveryProfile.sleepQuality} onChange={(e) => setForm((v) => ({ ...v, recoveryProfile: { ...v.recoveryProfile, sleepQuality: e.target.value } }))} /></Field>
            <Field label="Estrés habitual · 1–5"><input form="profile-form" type="number" min="1" max="5" value={form.recoveryProfile.stress} onChange={(e) => setForm((v) => ({ ...v, recoveryProfile: { ...v.recoveryProfile, stress: e.target.value } }))} /></Field>
          </div>
          <div className="strength-exercise-grid screening-grid"><label className="strength-exercise-option"><input form="profile-form" type="checkbox" checked={Boolean(form.recoveryProfile.physicalWork)} onChange={(e) => setForm((v) => ({...v,recoveryProfile:{...v.recoveryProfile,physicalWork:e.target.checked}}))} />Mi trabajo requiere esfuerzo físico</label><label className="strength-exercise-option"><input form="profile-form" type="checkbox" checked={Boolean(form.recoveryProfile.frequentTravel)} onChange={(e) => setForm((v) => ({...v,recoveryProfile:{...v.recoveryProfile,frequentTravel:e.target.checked}}))} />Viajo o trabajo por turnos con frecuencia</label></div>
          <section className="screening-section">
            <div className="subsection-label">Cuestionario de seguridad <span>Marca cualquier síntoma o condición actual</span></div>
            <p className="screening-warning">Si marcas alguna señal de alarma, la aplicación bloqueará la generación del plan y recomendará valoración sanitaria.</p>
            <label className="strength-exercise-option screening-review"><input form="profile-form" type="checkbox" checked={form.healthScreeningReviewed} onChange={(e) => setForm((v) => ({ ...v, healthScreeningReviewed: e.target.checked }))} />He leído y respondido el cuestionario de seguridad de abajo</label>
            <div className="strength-exercise-grid screening-grid">{healthQuestions.map(([key,label]) => <label className="strength-exercise-option" key={key}><input form="profile-form" type="checkbox" checked={Boolean(form.healthScreening[key])} onChange={() => toggleScreening("healthScreening",key)} />{label}</label>)}</div>
            <div className="subsection-label">Condiciones para un plan más conservador <span>Informativo; ajusta la carga y muestra una recomendación</span></div>
            <div className="strength-exercise-grid screening-grid">{precautionQuestions.map(([key,label]) => <label className="strength-exercise-option" key={key}><input form="profile-form" type="checkbox" checked={Boolean(form.precautionScreening[key])} onChange={() => toggleScreening("precautionScreening",key)} />{label}</label>)}</div>
          </section>
          <div className="subsection-label">
            Plan semanal <span>Elige entre 2 y 6 días y conserva un día completo de descanso</span>
          </div>
          <p className="schedule-helper">
            El trabajo de fuerza se plantea en gimnasio. Puedes combinar fuerza
            y carrera en un mismo día. Para cada sesión de carrera, elige cinta
            o calle. Si activas ambas, se crearán dos sesiones de carrera ese
            día.
          </p>
          <div className="weekly-training-grid">
            {dayNames.map((day, index) => {
              const selection =
                form.trainingSchedule[index] || emptyDayTraining;
              const active =
                selection.strength || selection.treadmill || selection.street;
              const options: {
                field: Exclude<keyof DayTraining, "maxSessionMinutes">;
                label: string;
                icon: React.ReactNode;
              }[] = [
                {
                  field: "strength",
                  label: "Fuerza",
                  icon: <Dumbbell size={15} />,
                },
                {
                  field: "treadmill",
                  label: "Carrera en cinta",
                  icon: <Activity size={15} />,
                },
                {
                  field: "street",
                  label: "Carrera en calle",
                  icon: <Footprints size={15} />,
                },
              ];
              return (
                <section
                  className={`training-day-card ${active ? "is-active" : ""}`}
                  key={day}
                >
                  <header className="training-day-heading">
                    <span className="training-day-initial">
                      {dayShort[index]}
                    </span>
                    <strong>{day}</strong>
                    <small>{active ? "Entrenamiento" : "Descanso"}</small>
                  </header>
                  <div className="training-day-options">
                    {options.map(({ field, label, icon }) => (
                      <label
                        className={`training-option ${selection[field] ? "is-selected" : ""}`}
                        key={field}
                      >
                        <input
                          type="checkbox"
                          checked={selection[field]}
                          onChange={() => toggleTraining(index, field)}
                        />
                        {icon}
                        <span>{label}</span>
                        <i>{selection[field] && <Check size={12} />}</i>
                      </label>
                    ))}
                    {selection.street && (
                      <label
                        className={`training-option long-run-option ${selection.longRun ? "is-selected" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={selection.longRun}
                          onChange={() => toggleTraining(index, "longRun")}
                        />
                        <TrendingUp size={15} />
                        <span>Tirada larga</span>
                        <i>{selection.longRun && <Check size={12} />}</i>
                      </label>
                    )}
                    {active && <label className="day-duration-limit"><span>Máx. sesión · min</span><input form="profile-form" type="number" min="15" max="300" value={selection.maxSessionMinutes || form.maxSessionMinutes} onChange={(e) => setForm((current) => ({...current,trainingSchedule:current.trainingSchedule.map((entry,i)=>i===index?{...entry,maxSessionMinutes:e.target.value}:entry)}))} /></label>}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="form-grid two-col">
            <Field
              label="Lesiones, molestias o limitaciones"
              hint="Incluye solo lo que debamos tener en cuenta."
              full
            >
              <textarea
                form="profile-form"
                value={form.limitations}
                onChange={(e) => update("limitations", e.target.value)}
                rows={3}
                placeholder="Ej.: rodilla sensible al bajar cuestas…"
              />
            </Field>
            <Field label="Preferencias de entrenamiento" full>
              <textarea
                form="profile-form"
                value={form.preferences}
                onChange={(e) => update("preferences", e.target.value)}
                rows={2}
                placeholder="Ej.: prefiero correr por la mañana…"
              />
            </Field>
          </div>
          <div className="form-actions profile-save-actions">
            <button
              className="button button-primary"
              form="profile-form"
              disabled={busy}
            >
              Guardar perfil <Save size={15} />
            </button>
          </div>
        </section>
      </div>
      <aside className="profile-side-column">
        <section className="panel goal-form-panel">
          <div className="form-section-heading">
            <span className="section-icon section-icon-goal">
              <Target size={18} />
            </span>
            <div>
              <h3>Tu objetivo</h3>
              <p>La meta que marca el horizonte.</p>
            </div>
          </div>
          <form onSubmit={(e) => void saveGoal(e)} className="goal-form">
            <Field label="Distancia">
              <select
                value={goalForm.distanceKm}
                onChange={(e) =>
                  setGoalForm((g) => ({
                    ...g,
                    distanceKm: Number(e.target.value),
                  }))
                }
              >
                <option value={1}>1K</option>
                <option value={1.609}>Milla</option>
                <option value={3}>3K</option>
                <option value={5}>5K</option>
                <option value={10}>10K</option>
                <option value={21.097}>Media maratón · 21,1 km</option>
                <option value={42.195}>Maratón · 42,2 km</option>
              </select>
            </Field>
            <Field label="Fecha de la carrera">
              <input
                type="date"
                min={todayISO()}
                value={goalForm.raceDate}
                onChange={(e) =>
                  setGoalForm((g) => ({ ...g, raceDate: e.target.value }))
                }
                required
              />
            </Field>
            <Field label="Prioridad"><select value={goalForm.priority || "finish_healthy"} onChange={(e) => setGoalForm((g) => ({ ...g, priority: e.target.value }))}><option value="finish_healthy">Completar con salud</option><option value="improve_fitness">Mejorar condición</option><option value="time_goal">Buscar un tiempo</option></select></Field>
            <Field label="Terreno"><select value={goalForm.terrain || "road"} onChange={(e) => setGoalForm((g) => ({ ...g, terrain: e.target.value }))}><option value="road">Asfalto</option><option value="track">Pista</option><option value="trail">Trail</option><option value="treadmill">Cinta</option><option value="mixed">Mixto</option></select></Field>
            <Field label="Desnivel positivo · m (opcional)"><input type="number" min="0" max="5000" value={goalForm.elevationGainM || ""} onChange={(e) => setGoalForm((g) => ({ ...g, elevationGainM: e.target.value }))} /></Field>
            <Field label="Tiempo objetivo (opcional)">
              <div className="input-unit">
                <input
                  type="number"
                  min="1"
                  max="600"
                  step="0.5"
                  value={goalForm.targetTimeMin || ""}
                  onChange={(e) =>
                    setGoalForm((g) => ({
                      ...g,
                      targetTimeMin: e.target.value,
                    }))
                  }
                  placeholder="Solo completar"
                />
                <span>min</span>
              </div>
            </Field>
            <div className="time-hint">
              Sin una marca objetivo, guiaremos la intensidad por sensaciones.
            </div>
            <button
              className="button button-outline button-full"
              disabled={busy}
            >
              Guardar objetivo <Check size={15} />
            </button>
          </form>
        </section>
        <section className="panel generate-panel">
          <div className="generate-glow">
            <Sparkles size={20} />
          </div>
          <span className="eyebrow">SIGUIENTE PASO</span>
          <h3>Juntamos las piezas.</h3>
          <p>
            Con tu perfil y objetivo listos, preparamos un plan híbrido con
            carrera, fuerza y descanso.
          </p>
          <button
            className="button button-primary button-full"
            disabled={
              busy ||
              !goalForm.raceDate ||
              activeTrainingDays(form.trainingSchedule) < 2 ||
              !hasRunningSession(form.trainingSchedule)
            }
            onClick={() => void generate()}
          >
            {busy ? "Preparando plan…" : dataPlanLabel(current)}
            <ArrowRight size={16} />
          </button>
          {!hasRunningSession(form.trainingSchedule) && (
            <p className="generate-inline-hint">
              Marca al menos una sesión de carrera en cinta o en calle.
            </p>
          )}
          <div className="generate-checks">
            <span>
              <CheckCircle2 size={14} />
              Progresión por fases
            </span>
            <span>
              <CheckCircle2 size={14} />
              Carrera + fuerza
            </span>
            <span>
              <CheckCircle2 size={14} />
              Versiones guardadas
            </span>
          </div>
        </section>
        <div className="privacy-card">
          <ShieldCheck size={16} />
          <span>
            Tus datos se guardan localmente en este ordenador. No se envían a
            servicios externos.
          </span>
        </div>
      </aside>
    </div>
  );
}
function dataPlanLabel(current: Profile | null) {
  return current ? "Generar nuevo plan" : "Generar mi primer plan";
}

type ManagedUser = {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: string;
};

type StrengthConfig = { division: string; exercises: string[] };
type StrengthCatalog = { divisions: string[]; groups: Record<string, string[]> };
function StrengthAdminView({ runAction }: { runAction: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null> }) {
  const [config, setConfig] = useState<StrengthConfig>({ division: "Torso/Pierna", exercises: [] });
  const [catalog, setCatalog] = useState<StrengthCatalog | null>(null);
  useEffect(() => {
    void api<{ config: StrengthConfig; catalog: StrengthCatalog }>("/api/admin/strength")
      .then((result) => { setConfig(result.config); setCatalog(result.catalog); })
      .catch(() => {});
  }, []);
  function toggleExercise(exercise: string) {
    setConfig((current) => ({ ...current, exercises: current.exercises.includes(exercise) ? current.exercises.filter((item) => item !== exercise) : [...current.exercises, exercise] }));
  }
  async function save() {
    await runAction(async () => { await api("/api/admin/strength", { method: "PUT", body: JSON.stringify(config) }); }, "Configuración de fuerza guardada.");
  }
  return (
    <div className="settings-layout">
      <section className="panel settings-intro"><div className="settings-shield"><Dumbbell size={23} /></div><div><div className="eyebrow">CATÁLOGO DE EJERCICIOS</div><h2>Configura las sesiones de fuerza</h2><p>Los planes nuevos utilizarán exclusivamente los ejercicios seleccionados. Puedes actualizar esta selección cuando quieras.</p></div></section>
      <section className="panel admin-users-panel">
        <div className="panel-heading"><div><span className="eyebrow">DIVISIÓN DE ENTRENAMIENTO</span><h3>Elige una estructura</h3></div></div>
        <div className="strength-division-options">{catalog?.divisions.map((division) => <label className="strength-division-option" key={division}><input type="radio" name="strength-division" checked={config.division === division} onChange={() => setConfig((current) => ({ ...current, division }))} /><span>{division}</span></label>)}</div>
      </section>
      {catalog && Object.entries(catalog.groups).map(([group, exercises]) => (
        <section className="panel strength-group-panel" key={group}>
          <div className="panel-heading"><div><span className="eyebrow">EJERCICIOS</span><h3>{group}</h3></div><span className="strength-selected-count">{exercises.filter((exercise) => config.exercises.includes(exercise)).length} seleccionados</span></div>
          <div className="strength-exercise-grid">{exercises.map((exercise) => <label className="strength-exercise-option" key={exercise}><input type="checkbox" checked={config.exercises.includes(exercise)} onChange={() => toggleExercise(exercise)} /><span>{exercise}</span></label>)}</div>
        </section>
      ))}
      <div className="strength-save-row"><span>{config.exercises.length} ejercicios seleccionados</span><button className="button button-primary" disabled={!config.exercises.length} onClick={() => void save()}><Save size={15} /> Guardar configuración</button></div>
    </div>
  );
}

function AdminView({
  runAction,
}: {
  runAction: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
}) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [passwords, setPasswords] = useState<Record<number, string>>({});
  async function refreshUsers() {
    const result = await api<{ users: ManagedUser[] }>("/api/admin/users");
    setUsers(result.users);
  }
  useEffect(() => {
    void refreshUsers().catch(() => setUsers([]));
  }, []);
  async function clearUser(user: ManagedUser) {
    if (
      !window.confirm(
        `¿Borrar el perfil, objetivo, planes y actividades de ${user.username}? La cuenta seguirá existiendo.`,
      )
    )
      return;
    await runAction(async () => {
      await api(`/api/admin/users/${user.id}/clear`, {
        method: "POST",
        body: "{}",
      });
    }, `Datos de ${user.username} borrados.`);
  }
  async function deleteUser(user: ManagedUser) {
    if (
      !window.confirm(
        `¿Eliminar por completo la cuenta ${user.username} y todos sus datos? Esta acción no se puede deshacer.`,
      )
    )
      return;
    const result = await runAction(async () => {
      await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
      await refreshUsers();
    }, `Usuario ${user.username} eliminado.`);
    return result;
  }
  async function resetPassword(user: ManagedUser) {
    const password = passwords[user.id] || "";
    if (password.length < 6) return;
    const result = await runAction(async () => {
      await api(`/api/admin/users/${user.id}/password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setPasswords((all) => ({ ...all, [user.id]: "" }));
    }, `Contraseña de ${user.username} actualizada.`);
    return result;
  }
  return (
    <div className="settings-layout">
      <section className="panel settings-intro">
        <div className="settings-shield">
          <ShieldCheck size={23} />
        </div>
        <div>
          <div className="eyebrow">CONTROL DE CUENTAS</div>
          <h2>Administración de usuarios</h2>
          <p>
            Elimina cuentas, borra sus datos sin quitar el acceso o restablece
            la contraseña. Cada persona solo puede consultar su propio
            historial.
          </p>
        </div>
      </section>
      <section className="panel admin-users-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CUENTAS REGISTRADAS</span>
            <h3>
              {users.length} {users.length === 1 ? "usuario" : "usuarios"}
            </h3>
          </div>
          <button
            className="button button-outline"
            onClick={() => void refreshUsers()}
          >
            Actualizar <RefreshCw size={14} />
          </button>
        </div>
        <div className="admin-users-list">
          {users.map((user) => (
            <article className="admin-user-card" key={user.id}>
              <div className="admin-user-identity">
                <div className="avatar">
                  {user.username.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <strong>{user.username}</strong>
                  <span>
                    {user.isAdmin
                      ? "Administrador"
                      : `Cuenta creada · ${prettyDate(user.createdAt.slice(0, 10), { day: "numeric", month: "short", year: "numeric" })}`}
                  </span>
                </div>
              </div>
              <>
                <div className="admin-reset-row">
                  <input
                    aria-label={`Nueva contraseña para ${user.username}`}
                    type="password"
                    minLength={6}
                    maxLength={256}
                    placeholder="Nueva contraseña (mín. 6)"
                    value={passwords[user.id] || ""}
                    onChange={(e) =>
                      setPasswords((all) => ({
                        ...all,
                        [user.id]: e.target.value,
                      }))
                    }
                  />
                  <button
                    className="button button-outline"
                    disabled={(passwords[user.id] || "").length < 6}
                    onClick={() => void resetPassword(user)}
                  >
                    Restablecer
                  </button>
                </div>
                <div className="admin-user-actions">
                  <button
                    className="button button-outline"
                    onClick={() => void clearUser(user)}
                  >
                    Borrar sus datos
                  </button>
                  {!user.isAdmin && (
                    <button
                      className="button button-danger"
                      onClick={() => void deleteUser(user)}
                    >
                      Eliminar usuario
                    </button>
                  )}
                </div>
              </>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function SettingsView({
  runAction,
  refresh,
}: {
  runAction: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
  refresh: () => Promise<void>;
}) {
  const [backupBusy, setBackupBusy] = useState(false);
  async function downloadBackup() {
    setBackupBusy(true);
    const result = await runAction(async () => {
      const response = await fetch("/api/export");
      if (!response.ok) throw new Error("No se pudo exportar la copia.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rompesuelas-copia-${todayISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }, "Copia de seguridad descargada.");
    setBackupBusy(false);
    return result;
  }
  async function restore(file?: File) {
    if (!file) return;
    await runAction(async () => {
      const backup = JSON.parse(await file.text());
      await api("/api/import-backup", {
        method: "POST",
        body: JSON.stringify(backup),
      });
      await refresh();
    }, "Copia restaurada correctamente.");
  }
  return (
    <div className="settings-layout">
      <section className="panel settings-intro">
        <div className="settings-shield">
          <ShieldCheck size={23} />
        </div>
        <div>
          <div className="eyebrow">PRIVACIDAD LOCAL</div>
          <h2>Tu entrenamiento es tuyo.</h2>
          <p>
            Tu perfil, plan y actividades permanecen en la base de datos local
            del ordenador donde ejecutas Rompesuelas. El móvil accede a través de tu
            red Wi‑Fi.
          </p>
        </div>
      </section>
      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="settings-card-icon">
            <ArrowDownToLine size={19} />
          </div>
          <h3>Guarda una copia</h3>
          <p>
            Descarga tu perfil, objetivo, actividades y todas las versiones del
            plan en un archivo JSON.
          </p>
          <button
            className="button button-outline"
            disabled={backupBusy}
            onClick={() => void downloadBackup()}
          >
            {backupBusy ? "Preparando…" : "Exportar mis datos"}
            <ArrowDownToLine size={15} />
          </button>
        </section>
        <section className="panel settings-card">
          <div className="settings-card-icon">
            <RefreshCw size={19} />
          </div>
          <h3>Restaura una copia</h3>
          <p>
            Recupera tus datos desde un archivo exportado previamente. Esto
            reemplazará el historial actual.
          </p>
          <label className="button button-outline settings-file-label">
            Seleccionar archivo JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                void restore(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </section>
      </div>
      <div className="backup-warning">
        <CircleHelp size={16} />
        <span>
          Guarda las copias en un lugar seguro. Las copias exportadas no
          incluyen tu contraseña de acceso.
        </span>
      </div>
    </div>
  );
}

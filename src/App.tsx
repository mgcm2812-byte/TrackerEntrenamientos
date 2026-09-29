import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
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
};
type Plan = {
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
  trainingDays: number[];
  equipment: string[];
  limitations: string;
  preferences: string;
};
type Goal = {
  distanceKm: number;
  raceDate: string;
  targetTimeMin: number | string | null;
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
  note: string;
  createdAt?: string;
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
    plan: Plan;
  };
};
type View = "overview" | "plan" | "history" | "profile" | "settings";

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
const defaultProfile: Profile = {
  name: "",
  age: "",
  weightKg: "",
  heightCm: "",
  experience: "intermedio",
  weeklyKm: "12",
  longestRunKm: "6",
  recent5kMin: "",
  trainingDays: [0, 2, 4, 5],
  equipment: ["Mancuernas", "Gimnasio"],
  limitations: "",
  preferences: "",
};
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
    ? `${goal.distanceKm === 21.1 ? "Media maratón" : `${goal.distanceKm}K`}`
    : "Tu próxima meta";
}
function firstName(name?: string) {
  return name?.trim().split(/\s+/)[0] || "atleta";
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [data, setData] = useState<AppData>(emptyState);
  const [view, setView] = useState<View>("overview");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  async function reload() {
    const next = await api<AppData>("/api/state");
    setData(next);
  }
  useEffect(() => {
    api<{ authenticated: boolean; needsSetup: boolean }>("/api/session")
      .then(async (session) => {
        setAuthenticated(session.authenticated);
        setNeedsSetup(session.needsSetup);
        if (session.authenticated) await reload();
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
    setData(emptyState);
  }
  if (authenticated === null)
    return (
      <div className="loading-screen">
        <div className="brand-mark">S</div>
        <p>Preparando tu espacio...</p>
      </div>
    );
  if (!authenticated)
    return (
      <LoginScreen
        needsSetup={needsSetup}
        initialError={error}
        onReady={() => {
          setAuthenticated(true);
          setNeedsSetup(false);
          void reload();
        }}
      />
    );

  const navigate = (next: View) => {
    setView(next);
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
          <div className="brand-mark">S</div>
          <div>
            <span className="brand-name">stride</span>
            <span className="brand-label">HYBRID COACH</span>
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
              <strong>{data.profile?.name || "Tu perfil"}</strong>
              <span>Atleta personal</span>
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
              <span>Stride</span>
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
              {(data.profile?.name || "A").trim().slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "overview"
                  ? "TU CENTRO DE ENTRENAMIENTO"
                  : "STRIDE / PERSONAL"}
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
          {view === "history" && (
            <HistoryView
              data={data}
              busy={busy}
              runAction={action}
              refresh={reload}
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
  needsSetup,
  initialError = "",
  onReady,
}: {
  needsSetup: boolean;
  initialError?: string;
  onReady: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (needsSetup && password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      await api(needsSetup ? "/api/setup" : "/api/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      onReady();
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
          <div className="brand-mark">S</div>
          <span>stride</span>
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
          <div className="brand-mark">S</div>
          <b>stride</b>
        </div>
        <div className="auth-form-wrap">
          <div className="auth-lock">
            <LockKeyhole size={21} />
          </div>
          <span className="eyebrow">
            {needsSetup ? "TU ESPACIO PERSONAL" : "HOLA DE NUEVO"}
          </span>
          <h1>{needsSetup ? "Empieza por aquí." : "Qué bueno verte."}</h1>
          <p>
            {needsSetup
              ? "Crea una contraseña para mantener tu entrenamiento privado en tu red."
              : "Entra para seguir construyendo tu progreso."}
          </p>
          <form onSubmit={(e) => void submit(e)} className="auth-form">
            <label>
              Contraseña
              <input
                type="password"
                autoComplete={needsSetup ? "new-password" : "current-password"}
                minLength={needsSetup ? 12 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  needsSetup ? "Al menos 12 caracteres" : "Tu contraseña"
                }
                required
              />
            </label>
            {needsSetup && (
              <label>
                Repite la contraseña
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
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
                : needsSetup
                  ? "Crear mi espacio"
                  : "Entrar"}
              <ArrowRight size={16} />
            </button>
          </form>
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
}: {
  session: Session;
  compact?: boolean;
  onStatus?: (status: "completed" | "skipped") => void;
}) {
  const today = session.date === todayISO();
  return (
    <article
      className={`session-pill session-${session.type} ${today ? "is-today" : ""} ${session.status === "completed" ? "is-complete" : ""} ${session.status === "skipped" ? "is-skipped" : ""} ${compact ? "is-compact" : ""}`}
    >
      <div className="session-date-block">
        <span>
          {compact
            ? dayShort[(new Date(`${session.date}T12:00:00`).getDay() + 6) % 7]
            : prettyDate(session.date, { weekday: "short" })}
        </span>
        <strong>{new Date(`${session.date}T12:00:00`).getDate()}</strong>
      </div>
      <div className="session-icon">
        <SessionIcon type={session.type} />
      </div>
      <div className="session-info">
        <div className="session-title-row">
          <h4>{session.title}</h4>
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
      {onStatus && session.status === "pending" && (
        <div className="session-status-actions">
          <button
            className="session-complete"
            title="Marcar como completada"
            onClick={() => onStatus("completed")}
          >
            <Check size={15} />
          </button>
          <button
            className="session-skip"
            title="Marcar como omitida"
            onClick={() => onStatus("skipped")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </article>
  );
}
function WeekPreview({ sessions }: { sessions: Session[] }) {
  const days = weekDates(todayISO());
  return (
    <div className="week-preview">
      {days.map((date, index) => {
        const item = sessions.find((s) => s.date === date);
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
            {item ? (
              <span
                className={`week-day-marker marker-${item.type}`}
                title={item.title}
              >
                <SessionIcon type={item.type} />
              </span>
            ) : (
              <span className="week-day-rest" />
            )}
          </div>
        );
      })}
      <div className="week-preview-list">
        {sessions.length ? (
          sessions
            .slice(0, 3)
            .map((s) => <SessionPill key={s.id} session={s} compact />)
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
  const plan = data.plan;
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
          <span>CARRERA ESTA SEMANA</span>
          <strong>
            {runKm.toLocaleString("es-ES", { maximumFractionDigits: 1 })}{" "}
            <small>km</small>
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
            const session = sessions.find((s) => s.date === date);
            const selected = date === todayISO();
            return (
              <button
                key={date}
                className={`schedule-day ${selected ? "selected" : ""} ${session ? `scheduled-${session.type}` : ""}`}
                onClick={() => {
                  const el = document.getElementById(`date-${date}`);
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                <span>{dayNames[index].slice(0, 3).toUpperCase()}</span>
                <strong>{new Date(`${date}T12:00:00`).getDate()}</strong>
                <i>
                  {session
                    ? session.type === "strength"
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
            const item = sessions.find((s) => s.date === date);
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
                {item ? (
                  <SessionPill
                    session={item}
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
      <PlanTip />
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
}: {
  data: AppData;
  busy: boolean;
  runAction: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
  refresh: () => Promise<void>;
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
              <div className="activity-row" key={a.id || a.fileHash || i}>
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
                      {a.type === "strength"
                        ? "Entrenamiento de fuerza"
                        : a.type === "other"
                          ? "Otra actividad"
                          : a.source
                            ? `Carrera · ${a.source}`
                            : "Carrera"}
                    </strong>
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
              </div>
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
  const initial = current || defaultProfile;
  const [form, setForm] = useState<Profile>({ ...defaultProfile, ...initial });
  const [goalForm, setGoalForm] = useState<Goal>({
    distanceKm: 5,
    raceDate: "",
    targetTimeMin: "",
  });
  useEffect(() => {
    setForm({ ...defaultProfile, ...(current || {}) });
  }, [current]);
  useEffect(() => {
    if (goal) setGoalForm({ ...goal, targetTimeMin: goal.targetTimeMin ?? "" });
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
  const toggleDay = (day: number) =>
    setForm((f) => ({
      ...f,
      trainingDays: f.trainingDays.includes(day)
        ? f.trainingDays.filter((d) => d !== day)
        : [...f.trainingDays, day].sort(),
    }));
  const toggleEquipment = (equipment: string) =>
    setForm((f) => ({
      ...f,
      equipment: f.equipment.includes(equipment)
        ? f.equipment.filter((e) => e !== equipment)
        : [...f.equipment, equipment],
    }));
  const update = (key: keyof Profile, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
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
          </div>
          <div className="subsection-label">
            ¿Qué días tienes para entrenar? <span>Elige al menos dos</span>
          </div>
          <div className="day-selector">
            {dayNames.map((day, index) => (
              <button
                type="button"
                key={day}
                className={form.trainingDays.includes(index) ? "chosen" : ""}
                onClick={() => toggleDay(index)}
              >
                <span>{dayShort[index]}</span>
                <small>{day}</small>
                {form.trainingDays.includes(index) && (
                  <i>
                    <Check size={10} />
                  </i>
                )}
              </button>
            ))}
          </div>
          <div className="subsection-label">¿Con qué equipo cuentas?</div>
          <div className="chip-group">
            {[
              "Gimnasio",
              "Mancuernas",
              "Barra y discos",
              "Bandas elásticas",
              "Peso corporal",
              "Kettlebell",
            ].map((item) => (
              <button
                type="button"
                key={item}
                className={`choice-chip ${form.equipment.includes(item) ? "selected" : ""}`}
                onClick={() => toggleEquipment(item)}
              >
                {form.equipment.includes(item) && <Check size={12} />}
                {item}
              </button>
            ))}
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
                <option value={5}>5K</option>
                <option value={10}>10K</option>
                <option value={21.1}>Media maratón · 21,1 km</option>
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
            <Field label="Tiempo objetivo (opcional)">
              <div className="input-unit">
                <input
                  type="number"
                  min="10"
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
              busy || !goalForm.raceDate || form.trainingDays.length < 2
            }
            onClick={() => void generate()}
          >
            {busy ? "Preparando plan…" : dataPlanLabel(current)}
            <ArrowRight size={16} />
          </button>
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
      a.download = `stride-copia-${todayISO()}.json`;
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
            del ordenador donde ejecutas Stride. El móvil accede a través de tu
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

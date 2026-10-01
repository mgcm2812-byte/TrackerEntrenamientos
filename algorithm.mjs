export const ALGORITHM_VERSION = "RUN-HYBRID-2.0.0";
export const RULESET_VERSION = "2026.2";
export const RULES_REVIEWED = "2026-10-01";
export const STRENGTH_ALGORITHM_VERSION = "STRENGTH-1.0.0";
export const STRENGTH_RULESET_VERSION = "2026.1";
export const ALGORITHM_CONFIG = Object.freeze({
  maximumWeeklyIncreasePctByLevel: { 0:0, 1:0, 2:0.05, 3:0.07, 4:0.08 },
  deloadEveryWeeks: 4,
  deloadReductionPct: 0.2,
  recovery: { minimumLowLoadDaysPerWeek: 1, consecutiveHardDaysAllowed: 0 },
  strength: { targetRIR:[2,4], taperVolumeReductionPct:0.5 },
  pain: { worseningStops:true, alteredGaitStops:true },
  riegelExponentByLevel: { 0:1.1, 1:1.1, 2:1.1, 3:1.07, 4:1.06 },
});

const weekDays = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const redFlags = [
  ["chestPain", "CHEST_PAIN"], ["fainting", "SYNCOPE"],
  ["unusualBreathlessness", "UNUSUAL_BREATHLESSNESS"],
  ["palpitationsWithSymptoms", "PALPITATIONS_WITH_SYMPTOMS"],
  ["heartConditionWithoutClearance", "CARDIOVASCULAR_CONDITION_NO_CLEARANCE"],
  ["acutePainChangesGait", "ACUTE_PAIN_ALTERED_GAIT"], ["cannotBearWeight", "CANNOT_BEAR_WEIGHT"],
  ["majorSwelling", "MAJOR_SWELLING"], ["fever", "FEVER"],
  ["neurologicalSymptoms", "NEUROLOGICAL_SYMPTOMS"],
  ["recentSurgeryWithoutClearance", "SURGERY_NO_CLEARANCE"], ["progressivePain", "PROGRESSIVE_PAIN"],
];
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const isoDay = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const mondayOf = (value) => { const d = new Date(value); d.setHours(0,0,0,0); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d; };
const dateAt = (start, day, week=0) => { const d = new Date(start); d.setDate(d.getDate()+week*7+day); return d; };
function scalePlannedSession(session, duration) {
  const previous=Math.max(1,Number(session.durationMin)||duration);
  const factor=duration/previous;
  session.durationMin=duration;
  if(session.distanceKm) session.distanceKm=Math.round(session.distanceKm*factor*10)/10;
  if(session.load) for(const key of Object.keys(session.load)) session.load[key]=Math.round(Number(session.load[key]||0)*factor);
  if(session.sessionLoad) session.sessionLoad=Math.round(session.sessionLoad*factor);
  if(session.impactLoad) session.impactLoad=Math.round(session.impactLoad*factor);
}

function paceText(paceSeconds) {
  const total=Math.round(paceSeconds);
  return `${Math.floor(total/60)}:${String(total%60).padStart(2,"0")}`;
}
function speedText(paceSeconds) {
  return `${(3600/paceSeconds).toFixed(1).replace(".",",")} km/h`;
}
function paceCue(reference5kMinutes, zone, environment) {
  if(!reference5kMinutes) return zone.rpe;
  const pace=reference5kMinutes*60/5;
  const fasterPace=pace*zone.range[0], slowerPace=pace*zone.range[1];
  return environment==="treadmill"
    ? `${speedText(slowerPace)}–${speedText(fasterPace)} (RPE ${zone.rpe})`
    : `${paceText(fasterPace)}–${paceText(slowerPace)} min/km (RPE ${zone.rpe})`;
}
const RUN_ZONES={
  recovery:{range:[1.25,1.38],rpe:"2–3, conversación completa"},
  easy:{range:[1.16,1.28],rpe:"3–4, frases completas"},
  steady:{range:[1.08,1.15],rpe:"5–6, controlado y estable"},
  threshold:{range:[1.04,1.10],rpe:"6–7, exigente pero sostenible"},
  interval:{range:[0.96,1.02],rpe:"7–8, rápido y técnicamente limpio; nunca sprint"},
  stride:{range:[0.91,0.98],rpe:"ágil y relajado; no sprint"},
};

function classifyAthlete(profile, history) {
  const experience = num(profile.runningExperienceMonths, 0);
  const weeklyRuns = history.weeklyRuns;
  const weeklyMinutes = history.weeklyMinutes;
  const longestMinutes = history.longestMinutes;
  let level = 4;
  if (!profile.canWalk30Minutes || profile.painWhileWalking) level = 0;
  else if (weeklyRuns < 2 || weeklyMinutes < 60 || num(profile.continuousRunMinutes) < 20 || history.breakWeeks >= 8) level = 1;
  else if (weeklyRuns < 3 || longestMinutes < 40 || experience < 6) level = 2;
  else if (weeklyRuns < 4 || longestMinutes < 60 || experience < 24) level = 3;
  if (profile.precautionScreening?.recurrentInjury || history.recentPain) level = Math.min(level, 2);
  if (history.breakWeeks >= 2) level = Math.min(level, history.breakWeeks >= 4 ? 1 : 2);
  return level;
}

function strengthRoutine(config, week, strengthIndex, strengthDays, catalog, currentDay, protectedRunDays) {
  const division = config.division;
  const split = division === "FullBody"
    ? [["Espalda", "Pecho", "Hombro", "Brazo", "Pierna", "Core"]]
    : division === "Tirón/Empuje/Pierna"
      ? [["Espalda", "Brazo", "Core"], ["Pecho", "Hombro", "Brazo", "Core"], ["Pierna", "Core"]]
      : [["Espalda", "Pecho", "Hombro", "Brazo", "Core"], ["Pierna", "Core"]];
  const splitIndex = (week * strengthDays.length + strengthIndex) % split.length;
  const chosen = new Set(config.exercises || []);
  const protectLegs = protectedRunDays.has((currentDay+1)%7);
  const groups = split[splitIndex].filter((group)=>!(protectLegs&&group==="Pierna"));
  const exercises = groups.flatMap((group) => {
    if(group==="Pierna") return [];
    let options = (catalog.groups[group] || []).filter((name) => chosen.has(name));
    if (division === "Tirón/Empuje/Pierna" && group === "Brazo") {
      if (splitIndex === 0) options = options.filter((name) => /bíceps/i.test(name));
      if (splitIndex === 1) options = options.filter((name) => /tríceps/i.test(name));
    }
    return options.length ? [options[(week + strengthIndex) % options.length]] : [];
  });
  const prescriptions={};
  const legOptions=(catalog.groups.Pierna||[]).filter((name)=>chosen.has(name));
  if(groups.includes("Pierna")&&legOptions.length) {
    const cycle=week*strengthDays.length+strengthIndex;
    const rotate=(names,offset=0)=>{
      const available=names.filter((name)=>legOptions.includes(name));
      return available.length?available[((cycle+offset)%available.length+available.length)%available.length]:null;
    };
    const compound=rotate(["Sentadilla multipower","Prensa","Prensa horizontal"]);
    const extension=rotate(["Extensiones cuádriceps"],Math.floor(cycle/2));
    const hip=rotate(["Hip Thrust"]);
    const hamstring=rotate(["Curl femoral sentado","Curl femoral tumbado"],Math.floor(cycle/2));
    const accessory=rotate(["Gemelo en máquina","Abductor","Adductor"],cycle);
    const ordered=[compound,hip,hamstring];
    if(cycle%2===1) ordered.push(extension);
    ordered.push(accessory);
    const targets={
      "Sentadilla multipower":"Cuádriceps y glúteos (principal)",
      "Prensa":"Cuádriceps y glúteos (principal)",
      "Prensa horizontal":"Cuádriceps y glúteos (principal)",
      "Extensiones cuádriceps":"Cuádriceps (aislamiento)",
      "Hip Thrust":"Glúteos y extensión de cadera",
      "Curl femoral tumbado":"Isquiotibiales (flexión de rodilla)",
      "Curl femoral sentado":"Isquiotibiales (flexión de rodilla)",
      "Abductor":"Abductores de cadera y glúteo medio",
      "Adductor":"Aductores de cadera",
      "Gemelo en máquina":"Gemelos (flexión plantar del tobillo)",
    };
    for(const name of ordered.filter(Boolean)) {
      if(exercises.includes(name)) continue;
      exercises.push(name);
      const main=["Sentadilla multipower","Prensa","Prensa horizontal","Hip Thrust","Curl femoral sentado","Curl femoral tumbado"].includes(name);
      prescriptions[name]={target:targets[name],main,reps:name==="Gemelo en máquina"?"10–15":name==="Abductor"||name==="Adductor"?"12–15":name==="Extensiones cuádriceps"?"10–15":"8–12"};
    }
  }
  for(const name of exercises) {
    prescriptions[name] ||= {target:null,main:false,reps:/plancha/i.test(name)?"30–45 s":/pallof/i.test(name)?"10–12/lado":/crunch/i.test(name)?"10–15":"8–12"};
  }
  const coreOptions=new Set(catalog.groups.Core||[]);
  const exerciseOrder=[...exercises.filter((name)=>!coreOptions.has(name)),...exercises.filter((name)=>coreOptions.has(name))];
  return { division, exercises:exerciseOrder, splitIndex, prescriptions };
}

const strengthTemplates = {
  "FB-A": [
    ["Rodilla bilateral", ["Sentadilla goblet", "Prensa de piernas", "Sentadilla en multipower", "Sentadilla con barra"]],
    ["Empuje horizontal", ["Press de pecho en máquina", "Press banca con mancuernas", "Press banca con barra"]],
    ["Tirón horizontal", ["Remo sentado en polea", "Remo con pecho apoyado en máquina", "Remo con pecho apoyado con mancuernas", "Remo con mancuerna apoyado"]],
    ["Bisagra de cadera", ["Peso muerto rumano con mancuernas", "Pull-through en polea", "Extensión de cadera en banco", "Peso muerto rumano con barra"]],
    ["Flexión de rodilla", ["Curl femoral sentado", "Curl femoral tumbado"]],
    ["Flexión plantar de tobillo", ["Elevación de gemelos de pie", "Gemelo sentado en máquina", "Gemelo sentado con mancuerna", "Gemelo en prensa"]],
    ["Estabilidad anterior", ["Dead bug", "Plancha"]],
  ],
  "FB-B": [
    ["Rodilla unilateral", ["Split squat", "Zancada hacia atrás", "Step-up bajo", "Prensa unilateral"]],
    ["Tirón vertical", ["Jalón al pecho", "Dominada asistida", "Dominada libre"]],
    ["Empuje inclinado", ["Press inclinado con mancuernas", "Press inclinado en máquina", "Flexión inclinada"]],
    ["Extensión de cadera", ["Hip thrust en máquina", "Hip thrust con barra", "Puente de glúteos"]],
    ["Flexión de rodilla", ["Curl femoral sentado", "Curl femoral tumbado"]],
    ["Flexión plantar de tobillo", ["Gemelo sentado en máquina", "Gemelo sentado con mancuerna", "Elevación de gemelos de pie", "Gemelo en prensa"]],
    ["Antirrotación", ["Pallof press"]],
  ],
  "UPPER-A": [
    ["Empuje horizontal", ["Press de pecho en máquina", "Press banca con mancuernas", "Press banca con barra"]],
    ["Tirón horizontal", ["Remo sentado en polea", "Remo con pecho apoyado en máquina", "Remo con pecho apoyado con mancuernas", "Remo con mancuerna apoyado"]],
    ["Tirón vertical", ["Jalón al pecho", "Dominada asistida", "Dominada libre"]],
    ["Empuje inclinado", ["Press inclinado con mancuernas", "Press inclinado en máquina", "Flexión inclinada"]],
    ["Flexión de codo", ["Curl de bíceps con mancuerna", "Curl de bíceps en polea", "Curl con barra EZ"]],
  ],
  "UPPER-B": [
    ["Empuje inclinado", ["Press inclinado con mancuernas", "Press inclinado en máquina", "Flexión inclinada"]],
    ["Tirón horizontal", ["Remo con pecho apoyado en máquina", "Remo con pecho apoyado con mancuernas", "Remo sentado en polea", "Remo con mancuerna apoyado"]],
    ["Tirón vertical", ["Jalón al pecho", "Dominada asistida", "Dominada libre"]],
    ["Empuje vertical", ["Press hombro en máquina", "Press hombro con mancuernas"]],
    ["Deltoides posterior", ["Pájaro en máquina", "Pájaro en polea"]],
    ["Extensión de codo", ["Extensión de tríceps en polea", "Extensión de tríceps sobre cabeza en polea"]],
  ],
  "LOWER-A": [
    ["Rodilla bilateral", ["Sentadilla goblet", "Prensa de piernas", "Sentadilla en multipower", "Sentadilla con barra"]],
    ["Bisagra de cadera", ["Peso muerto rumano con mancuernas", "Pull-through en polea", "Extensión de cadera en banco", "Peso muerto rumano con barra"]],
    ["Flexión de rodilla", ["Curl femoral sentado", "Curl femoral tumbado"]],
    ["Flexión plantar de tobillo", ["Elevación de gemelos de pie", "Gemelo sentado en máquina", "Gemelo sentado con mancuerna", "Gemelo en prensa"]],
    ["Estabilidad anterior", ["Dead bug", "Plancha"]],
  ],
  "LOWER-B": [
    ["Rodilla unilateral", ["Split squat", "Zancada hacia atrás", "Step-up bajo", "Prensa unilateral"]],
    ["Extensión de cadera", ["Hip thrust en máquina", "Hip thrust con barra", "Puente de glúteos"]],
    ["Bisagra de cadera", ["Peso muerto rumano con mancuernas", "Pull-through en polea", "Extensión de cadera en banco", "Peso muerto rumano con barra"]],
    ["Flexión de rodilla", ["Curl femoral sentado", "Curl femoral tumbado"]],
    ["Dorsiflexión de tobillo", ["Tibialis raise", "Dorsiflexión con banda"]],
  ],
  PUSH: [
    ["Empuje horizontal", ["Press de pecho en máquina", "Press banca con mancuernas", "Press banca con barra"]],
    ["Empuje inclinado", ["Press inclinado con mancuernas", "Press inclinado en máquina", "Flexión inclinada"]],
    ["Deltoides lateral", ["Elevación lateral"]],
    ["Extensión de codo", ["Extensión de tríceps en polea", "Extensión de tríceps sobre cabeza en polea"]],
  ],
  PULL: [
    ["Tirón vertical", ["Jalón al pecho", "Dominada asistida", "Dominada libre"]],
    ["Tirón horizontal", ["Remo sentado en polea", "Remo con pecho apoyado en máquina", "Remo con pecho apoyado con mancuernas", "Remo con mancuerna apoyado"]],
    ["Deltoides posterior", ["Pájaro en máquina", "Pájaro en polea"]],
    ["Flexión de codo", ["Curl de bíceps con mancuerna", "Curl de bíceps en polea", "Curl con barra EZ"]],
  ],
  LEGS: [
    ["Rodilla bilateral", ["Sentadilla goblet", "Prensa de piernas", "Sentadilla en multipower", "Sentadilla con barra"]],
    ["Bisagra de cadera", ["Peso muerto rumano con mancuernas", "Pull-through en polea", "Hip thrust en máquina", "Peso muerto rumano con barra"]],
    ["Flexión de rodilla", ["Curl femoral sentado", "Curl femoral tumbado"]],
    ["Flexión plantar de tobillo", ["Elevación de gemelos de pie", "Gemelo sentado en máquina", "Gemelo sentado con mancuerna", "Gemelo en prensa"]],
    ["Antirrotación", ["Pallof press"]],
  ],
  "FB-LIGHT": [
    ["Empuje horizontal", ["Press de pecho en máquina", "Press banca con mancuernas", "Flexión inclinada"]],
    ["Tirón horizontal", ["Remo sentado en polea", "Remo con pecho apoyado en máquina", "Remo con pecho apoyado con mancuernas", "Remo con mancuerna apoyado"]],
    ["Estabilidad anterior", ["Dead bug", "Plancha"]],
  ],
};
const strengthTemplateLabels = { "FB-A": "Cuerpo completo A", "FB-B": "Cuerpo completo B", "FB-LIGHT": "Fuerza complementaria", "UPPER-A": "Torso A", "UPPER-B": "Torso B", "LOWER-A": "Pierna A", "LOWER-B": "Pierna B", PUSH: "Empuje", PULL: "Tirón", LEGS: "Pierna" };

function availableStrengthExercises(catalog) {
  return Object.values(catalog?.groups || {}).flat().map((entry) => typeof entry === "string" ? { name: entry, pattern: "", equipment: [], role: "base", complexity: "básica" } : entry);
}

function resolveStrengthTemplate(config, templateId, profile, recovery) {
  const all = availableStrengthExercises(config.catalog);
  const selectedNames = new Set(config.selected);
  const declaredEquipment = new Set(profile.strengthEquipment || []);
  const equipment = new Set(["Peso corporal", ...declaredEquipment]);
  if (declaredEquipment.has("Mancuernas")) equipment.add("Mancuerna");
  if (declaredEquipment.has("Banco/cajón")) { equipment.add("Banco"); equipment.add("Banco inclinado"); equipment.add("Banco/cajón"); }
  if (declaredEquipment.has("Barra y discos")) equipment.add("Barra");
  if (declaredEquipment.has("Barra EZ")) equipment.add("Barra EZ");
  if (declaredEquipment.has("Rack")) equipment.add("Rack");
  const canUse = (exercise) => selectedNames.has(exercise.name) && (profile.gymAccess !== false || (
    exercise.equipment.some((item) => ["Peso corporal", "Banda elástica"].includes(item))
      ? exercise.equipment.some((item) => equipment.has(item))
      : exercise.equipment.every((item) => equipment.has(item))
  ));
  const used = new Set();
  const result = [];
  const decisions = [];
  for (const [pattern, candidates] of strengthTemplates[templateId] || []) {
    let chosen = candidates.map((name) => all.find((exercise) => exercise.name === name)).find((exercise) => exercise && canUse(exercise) && !used.has(exercise.name));
    if (!chosen) chosen = all.find((exercise) => exercise.pattern === pattern && canUse(exercise) && !used.has(exercise.name));
    if (!chosen) {
      decisions.push({ code: "STRENGTH_PATTERN_UNAVAILABLE", ruleId: "STRENGTH-CATALOG-001", reason: `No hay ejercicio seleccionado y disponible para el patrón ${pattern} en la plantilla ${templateId}.` });
      continue;
    }
    used.add(chosen.name);
    const optional = chosen.role === "opcional" || chosen.role === "alternativa" && ["Estabilidad anterior", "Antirrotación", "Dorsiflexión de tobillo", "Deltoides posterior", "Deltoides lateral", "Flexión de codo", "Extensión de codo"].includes(pattern);
    result.push({ name: chosen.name, pattern, equipment: chosen.equipment, role: optional ? "accessory" : "main", sets: 1, reps: optional ? "10–15" : "8–12", rir: 4, restSec: optional ? 75 : 120 });
    if (candidates[0] !== chosen.name) decisions.push({ code: "STRENGTH_EXERCISE_FALLBACK", ruleId: "STRENGTH-CATALOG-002", reason: `${chosen.name} sustituye a ${candidates[0]} para cubrir ${pattern} por la selección de catálogo o el equipo disponible.` });
  }
  const years = num(profile.strengthExperienceMonths, 0);
  const restarting = num(profile.weeksSinceTraining, 0) >= 4;
  const beginner = years < 4 || restarting;
  const fatigue = recovery.poorRecovery || recovery.precaution || recovery.recentPain;
  for (const exercise of result) {
    exercise.sets = exercise.role === "accessory" ? 1 : beginner ? 1 : 2;
    exercise.rir = beginner || fatigue ? 4 : 3;
  }
  return { exercises: result, decisions, beginner, fatigue };
}

function strengthTemplateAssignments(division, days, experienceMonths, fatigue) {
  const sortedDays = [...days].sort((a, b) => a - b);
  if (!sortedDays.length) return { assignments: [], omitted: [] };
  if (division === "FullBody" || division === "Cuerpo completo") {
    const keys = sortedDays.length === 1 ? ["FB-A"] : ["FB-A", "FB-B", "FB-A"];
    return { assignments: sortedDays.slice(0, 3).map((day, index) => ({ day, template: keys[index] })), omitted: sortedDays.slice(3) };
  }
  if (division === "Torso/Pierna") {
    if (sortedDays.length < 4) {
      const keys = sortedDays.length === 1 ? ["FB-A"] : ["FB-A", "FB-B", "FB-A"];
      return { assignments: sortedDays.slice(0, 3).map((day, index) => ({ day, template: keys[index] })), omitted: sortedDays.slice(3), fallback: "La división torso/pierna necesita cuatro días para repetir ambos tipos; se usa cuerpo completo para mantener frecuencia y cubrir patrones." };
    }
    const templates = ["UPPER-A", "LOWER-A", "UPPER-B", "LOWER-B", "FB-LIGHT"];
    return { assignments: sortedDays.slice(0, 5).map((day, index) => ({ day, template: templates[index] })), omitted: sortedDays.slice(5) };
  }
  if (division === "Tirón/Empuje/Pierna" || division === "Empuje/Tirón/Pierna") {
    if (sortedDays.length < 3) {
      const keys = sortedDays.length === 1 ? ["FB-A"] : ["FB-A", "FB-B"];
      return { assignments: sortedDays.map((day, index) => ({ day, template: keys[index] })), omitted: [], fallback: "La división empuje/tirón/pierna necesita tres días; se usa cuerpo completo para no dejar patrones sin entrenar." };
    }
    const canRepeat = sortedDays.length >= 6 && num(experienceMonths) >= 12 && !fatigue;
    const limit = canRepeat ? 6 : 3;
    const templates = canRepeat ? ["PUSH", "PULL", "LEGS", "PUSH", "PULL", "LEGS"] : ["PUSH", "PULL", "LEGS"];
    return { assignments: sortedDays.slice(0, limit).map((day, index) => ({ day, template: templates[index] })), omitted: sortedDays.slice(limit), fallback: sortedDays.length > 3 && !canRepeat ? "Se limita PPL a tres sesiones para priorizar la recuperación de carrera; el resto de días de fuerza se omite." : null };
  }
  return { assignments: sortedDays.map((day) => ({ day, template: "FB-A" })), omitted: [] };
}

function strengthSessionDuration(exercises) {
  const workAndRest = exercises.reduce((sum, exercise) => sum + exercise.sets * 1.25 + Math.max(0, exercise.sets - 1) * exercise.restSec / 60, 0);
  return Math.ceil((7 + workAndRest) / 5) * 5;
}

function buildStrengthSessions({ profile, goal, schedule, runSessions, strengthConfig, catalog, raceWeekIndex, totalWeeks, today, recovery }) {
  const normalizedDivision = ({ FullBody: "Cuerpo completo", "Tirón/Empuje/Pierna": "Empuje/Tirón/Pierna" })[strengthConfig.division] || strengthConfig.division;
  const selected = new Set(strengthConfig.exercises || []);
  const days = schedule.map((day, index) => day?.strength ? index : -1).filter((index) => index >= 0);
  const selection = strengthTemplateAssignments(normalizedDivision, days, profile.strengthExperienceMonths, recovery.poorRecovery || recovery.precaution || recovery.recentPain);
  const output = [];
  const decisions = [...(strengthConfig.migrationDecisions || [])];
  const warnings = [];
  if (selection.fallback) warnings.push(selection.fallback);
  if (selection.omitted.length) warnings.push(`Se omitieron ${selection.omitted.length} día(s) de fuerza seleccionados para mantener una dosis compatible con la prioridad de carrera.`);
  if (profile.gymAccess === false && !(profile.strengthEquipment || []).length) warnings.push("No se programó fuerza: declara el material doméstico disponible o indica acceso a gimnasio para poder elegir ejercicios compatibles.");
  for (let week = 0; week <= raceWeekIndex; week++) {
    if (week === raceWeekIndex) continue;
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7) + week * 7);
    const taper = goal.distanceKm === 21.097 && raceWeekIndex - week === 1;
    for (const assignment of selection.assignments) {
      const date = dateAt(weekStart, assignment.day);
      const dateKey = isoDay(date);
      if (dateKey < isoDay(today) || dateKey >= goal.raceDate) continue;
      const dayRuns = runSessions.filter((session) => session.date === dateKey);
      const dayCap = num(schedule[assignment.day]?.maxSessionMinutes, num(profile.maxSessionMinutes, 90));
      const runMinutes = dayRuns.reduce((sum, session) => sum + num(session.durationMin), 0);
      const availableMinutes = dayCap - runMinutes;
      if (availableMinutes < 20) {
        decisions.push({ code: "STRENGTH_REMOVED_DAILY_LIMIT", ruleId: "STRENGTH-SCHEDULE-001", reason: `${weekDays[assignment.day]} ya tiene ${runMinutes} min de carrera; no quedan 20 min para una sesión compacta de fuerza.` });
        continue;
      }
      // Only remove leg work when running and strength are scheduled on the same day.
      // Nearby quality/long-run sessions must not suppress otherwise available leg training.
      const legProtected = dayRuns.length > 0;
      const selectedTemplate = resolveStrengthTemplate({ catalog, selected }, assignment.template, profile, recovery);
      let exercises = selectedTemplate.exercises;
      decisions.push(...selectedTemplate.decisions);
      const requiredPatterns = (strengthTemplates[assignment.template] || []).filter(([pattern]) => !["Estabilidad anterior", "Antirrotación", "Dorsiflexión de tobillo", "Deltoides posterior", "Deltoides lateral", "Flexión de codo", "Extensión de codo"].includes(pattern)).map(([pattern]) => pattern);
      const missingRequired = requiredPatterns.filter((pattern) => !exercises.some((exercise) => exercise.pattern === pattern));
      if (missingRequired.length) {
        decisions.push({ code: "STRENGTH_SESSION_OMITTED_MISSING_EQUIPMENT", ruleId: "STRENGTH-EQUIPMENT-001", reason: `Se omitió ${assignment.template}: falta equipo o ejercicio seleccionado para ${missingRequired.join(", ")}.` });
        continue;
      }
      if (legProtected) {
        const before = exercises.length;
        exercises = exercises.filter((exercise) => !["Rodilla bilateral", "Rodilla unilateral", "Bisagra de cadera", "Extensión de cadera", "Flexión de rodilla", "Flexión plantar de tobillo", "Dorsiflexión de tobillo"].includes(exercise.pattern));
        if (before !== exercises.length) decisions.push({ code: "STRENGTH_LEGS_REDUCED_FOR_RUNNING", ruleId: "STRENGTH-RUN-001", reason: `Se retiró el trabajo de pierna de ${assignment.template} porque carrera y fuerza coinciden ese día.` });
      }
      if (!exercises.length) {
        decisions.push({ code: "STRENGTH_SESSION_OMITTED_NO_AVAILABLE_PATTERNS", ruleId: "STRENGTH-CATALOG-003", reason: `No hay patrones seleccionados y compatibles con el material/agenda para ${assignment.template}.` });
        continue;
      }
      const deload = !taper && week > 0 && week % 5 === 4;
      for (const exercise of exercises) if (taper || deload || selectedTemplate.fatigue) { exercise.sets = 1; exercise.rir = 4; }
      let duration = strengthSessionDuration(exercises);
      while (duration > availableMinutes) {
        const optionalIndex = exercises.map((exercise, index) => exercise.role === "accessory" ? index : -1).filter((index) => index >= 0).at(-1);
        if (optionalIndex !== undefined) exercises.splice(optionalIndex, 1);
        else {
          const reducible = [...exercises].reverse().find((exercise) => exercise.sets > 1);
          if (!reducible) break;
          reducible.sets -= 1;
        }
        duration = strengthSessionDuration(exercises);
      }
      if (duration > availableMinutes || !exercises.length) {
        decisions.push({ code: "STRENGTH_REMOVED_DAILY_LIMIT", ruleId: "STRENGTH-SCHEDULE-001", reason: `${assignment.template} necesita ${duration} min y quedan ${availableMinutes} min después de la carrera; se omite fuerza para no alterar la carrera.` });
        continue;
      }
      if (taper) decisions.push({ code: "STRENGTH_TAPER_REDUCED", ruleId: "STRENGTH-TAPER-001", reason: "En la semana previa de afinamiento de media maratón se limita cada ejercicio a una serie." });
      if (deload) decisions.push({ code: "STRENGTH_DELOAD_ASSIGNED", ruleId: "STRENGTH-DELOAD-001", reason: "Semana ligera planificada tras cuatro semanas de fuerza; una serie por ejercicio y RIR 4." });
      if (selectedTemplate.fatigue) decisions.push({ code: "STRENGTH_RECOVERY_REDUCED", ruleId: "STRENGTH-RECOVERY-001", reason: "Recuperación o señales recientes aconsejan una sola serie por ejercicio y RIR 4." });
      const strengthExercises = exercises.map((exercise) => ({ ...exercise, rir: legProtected ? Math.max(4, exercise.rir) : exercise.rir }));
      const exerciseText = strengthExercises.map((exercise) => `${exercise.name} (${exercise.pattern}) · ${exercise.sets} × ${exercise.reps} · RIR ${exercise.rir}`).join("; ");
      output.push({
        id: `w${week}-strength-${assignment.day}`, date: dateKey, day: weekDays[assignment.day], week: week + 1, phase: taper ? "Afinamiento" : deload ? "Descarga" : "Fuerza base",
        type: "strength", category: "STRENGTH", title: `Fuerza · ${strengthTemplateLabels[assignment.template] || assignment.template}`, durationMin: duration,
        effort: (() => { const low = Math.min(...strengthExercises.map((exercise) => exercise.rir)); const high = Math.max(...strengthExercises.map((exercise) => exercise.rir)); return `RIR ${low === high ? low : `${low}–${high}`} · controlado, sin fallo`; })(),
        details: `${exerciseText}. Calentamiento: 5–8 min suave y series de aproximación opcionales (no incluidas en las series de trabajo). Descanso: 2 min en ejercicios principales; 75 s en accesorios. Progresa primero en repeticiones; aumenta peso solo si mantienes técnica y RIR. ${legProtected ? "Trabajo de pierna retirado porque carrera y fuerza coinciden ese día." : "Termina cada serie con varias repeticiones posibles; no entrenes al fallo."}`,
        strengthTemplate: assignment.template, strengthExercises, status: "pending", sessionLoad: duration * 5, neuromuscularLoad: strengthExercises.reduce((sum, exercise) => sum + exercise.sets, 0),
        load: { cardiovascular: duration * 5, impact: 0, neuromuscular: strengthExercises.reduce((sum, exercise) => sum + exercise.sets, 0) * 8, strength: duration * 5 },
      });
    }
  }
  return { sessions: output, decisions, warnings, division: normalizedDivision, assignments: selection.assignments.map((assignment) => ({ day: assignment.day, template: assignment.template })) };
}

function generateLegacyHybridPlan(profile, goal, version, strengthConfig, catalog, history = [], now = new Date()) {
  if (!profile || !goal) throw Object.assign(new Error("Completa primero el perfil y el objetivo."), { status: 400 });
  const targetDate = new Date(`${goal.raceDate}T00:00:00`);
  const today = new Date(now); today.setHours(0,0,0,0);
  if (!goal.raceDate || Number.isNaN(targetDate.getTime()) || targetDate <= today)
    throw Object.assign(new Error("La fecha del objetivo debe ser futura."), { status: 400 });
  const safety = profile.healthScreening || {};
  if (!profile.healthScreeningReviewed) throw Object.assign(new Error("Revisa y confirma el cuestionario de seguridad del perfil antes de generar un plan."), { status:400 });
  const blockedFlags = redFlags.filter(([key]) => safety[key]).map(([, code]) => code);
  if (!profile.canWalk30Minutes || profile.painWhileWalking) blockedFlags.push(profile.painWhileWalking ? "PAIN_WHILE_WALKING" : "CANNOT_WALK_30_MINUTES");
  if (blockedFlags.length) throw Object.assign(new Error("No se puede generar el plan porque la evaluación indica señales que requieren valoración sanitaria. No entrenes con estos síntomas y consulta a un profesional de salud."), { status: 409, reasonCodes: blockedFlags });

  const schedule = Array.isArray(profile.trainingSchedule) ? profile.trainingSchedule : [];
  const active = schedule.map((day, index) => ({ day: day || {}, index }));
  if (active.filter(({day})=>day.strength||day.street||day.treadmill).length>6) throw Object.assign(new Error("Deja al menos un día completo de descanso para respetar la recuperación semanal."), {status:400});
  const runSlots = active.flatMap(({day,index}) => [
    ...(day.street ? [{ day:index, mode:"outdoor", longRun:Boolean(day.longRun), maxSessionMinutes:num(day.maxSessionMinutes,num(profile.maxSessionMinutes,90)) }] : []),
    ...(day.treadmill ? [{ day:index, mode:"treadmill", longRun:false, maxSessionMinutes:num(day.maxSessionMinutes,num(profile.maxSessionMinutes,90)) }] : []),
  ]);
  const strengthDays = active.filter(({day}) => day.strength).map(({index}) => index);
  if (!runSlots.length) throw Object.assign(new Error("Selecciona al menos un día de carrera para generar el plan."), { status:400 });
  const end = targetDate;
  const start = mondayOf(today);
  const weeksToRace = Math.max(1, Math.min(51, Math.floor((end-start)/(7*86400000))+1));
  const totalWeeks = weeksToRace + 1;
  const past28 = history.filter((a) => a.date >= isoDay(new Date(today.getTime()-28*86400000)) && a.type === "run");
  const recentActivities = history.filter((a) => a.date >= isoDay(new Date(today.getTime()-28*86400000)));
  const reportedRuns = num(profile.currentWeeklyRuns, 0);
  const reportedMinutes = num(profile.currentWeeklyMinutes, 0);
  const historyRuns = past28.length/4;
  const historyMinutes = past28.reduce((sum,a)=>sum+num(a.durationMin),0)/4;
  const weeklyRuns = Math.max(reportedRuns, historyRuns);
  const weeklyMinutes = Math.max(reportedMinutes, historyMinutes, num(profile.weeklyKm)*7.2);
  const longestRecentActivity = past28.reduce((max,a)=>Math.max(max,num(a.durationMin)),0);
  const longestMinutes = Math.max(num(profile.longestRunMinutes), longestRecentActivity, num(profile.longestRunKm)*7.2);
  const breakWeeks = num(profile.weeksSinceTraining,0);
  const recentPain = recentActivities.some((a)=>Boolean(a.soreness) || Boolean(a.painWorsening) || Boolean(a.painChangesGait));
  const athleteLevel = classifyAthlete(profile,{weeklyRuns,weeklyMinutes,longestMinutes,breakWeeks,recentPain});
  const levelName = ["Preparación", "Principiante absoluto", "Principiante", "Intermedio", "Experimentado"][athleteLevel];
  const warnings = [];
  const decisions = [];
  const recovery = profile.recoveryProfile || {};
  const poorBaselineRecovery = num(recovery.sleepQuality,3)<=1 || num(recovery.stress,2)>=5 || num(recovery.sleepHours,7)<5;
  const ageCaution = num(profile.age,0)>=60 && (weeklyRuns<2||weeklyMinutes<60);
  const demandingRecovery = Boolean(recovery.physicalWork||recovery.frequentTravel);
  const precautions = Object.values(profile.precautionScreening || {}).some(Boolean) || poorBaselineRecovery || ageCaution || demandingRecovery;
  if(poorBaselineRecovery) warnings.push("El sueño o el estrés habitual sugieren prudencia adicional; reduce carga si la recuperación diaria empeora.");
  if(demandingRecovery) warnings.push("El trabajo físico o los viajes frecuentes aumentan la carga externa; vigila fatiga y reduce la sesión si la recuperación es deficiente.");
  if(profile.gymAccess===false&&strengthDays.length) warnings.push("Hay sesiones de fuerza programadas, pero indicaste que no tienes acceso a gimnasio. Revisa que el equipo de los ejercicios seleccionados esté disponible antes de entrenar.");
  if(ageCaution) warnings.push("Se aplica una carga inicial conservadora por edad y baja actividad reciente.");
  if (precautions) warnings.push("Hay condiciones de salud o recuperación indicadas en el perfil. Usa RPE y conversación, mantén una carga conservadora y consulta con un profesional sanitario antes de iniciar si tienes dudas.");
  if (breakWeeks >= 2) warnings.push("Se detectó una interrupción del entrenamiento; el plan vuelve a una carga conservadora.");
  if (recentPain) warnings.push("El historial reciente incluye molestias; se eliminan las sesiones intensas.");
  if (weeklyMinutes === 0) warnings.push("Faltan datos de carga reciente; se inicia con sesiones cortas de carrera/caminata.");
  decisions.push({code:"ATHLETE_LEVEL_CLASSIFIED",ruleId:"PROFILE-LEVEL-001",reason:`Nivel ${athleteLevel} (${levelName}) por carga reciente, continuidad y tolerancia declarada.`});

  const distance = num(goal.distanceKm,5);
  const reported5k = num(profile.recent5kMin);
  const raceMarkDate = profile.recent5kDate ? new Date(`${profile.recent5kDate}T00:00:00`) : null;
  const markAgeDays = raceMarkDate ? Math.floor((today-raceMarkDate)/86400000) : Infinity;
  const recent5k = reported5k>0 && markAgeDays>=0 && markAgeDays<=365 ? reported5k : 0;
  const targetTime = num(goal.targetTimeMin);
  let predictedTimeMin = null;
  let goalClass = goal.priority==="finish_healthy"?"Conservador":"No evaluable por falta de datos";
  const goalReasons = [];
  if (recent5k > 0) {
    const k = ALGORITHM_CONFIG.riegelExponentByLevel[athleteLevel];
    predictedTimeMin = recent5k*Math.pow(distance/5,k);
    goalClass = !targetTime ? "Realista" : targetTime < predictedTimeMin*0.92 ? "No recomendable actualmente" : targetTime < predictedTimeMin*1.02 ? "Ambicioso" : targetTime <= predictedTimeMin*1.25 ? "Realista" : "Conservador";
    goalReasons.push(`Estimación central orientativa desde la marca 5K reciente: ${Math.round(predictedTimeMin)} minutos; no es una garantía de rendimiento.`);
    if (goalClass === "No recomendable actualmente") warnings.push("El tiempo objetivo parece más rápido que la estimación conservadora. El plan prioriza completar la preparación con seguridad; considera cambiar la meta de tiempo.");
  }
  if (!recent5k && reported5k>0) warnings.push("La marca 5K no tiene una fecha reciente verificable; no se usa para prescribir ritmo ni evaluar el objetivo.");
  if (!recent5k && (targetTime||goal.priority==="time_goal")) { goalClass = "No evaluable por falta de datos"; goalReasons.push("No hay marca reciente comparable y fechada para estimar el tiempo objetivo."); }
  const runningDayCount=new Set(runSlots.map((slot)=>slot.day)).size;
  const minimumRunDays=distance>=21?3:2;
  if(runningDayCount<minimumRunDays) {
    goalClass="No recomendable actualmente";
    goalReasons.push(`Hay ${runningDayCount} día(s) disponible(s) para correr; se recomiendan al menos ${minimumRunDays} para esta distancia.`);
    warnings.push("Aumenta los días disponibles para correr o elige una distancia menor; el calendario actual conserva al menos un día de descanso.");
  }
  const minimumPreparationWeeks = distance>=42?20:distance>=21?12:distance>=10?8:4;
  if(weeksToRace<minimumPreparationWeeks) {
    goalClass="No recomendable actualmente";
    goalReasons.push(`Hay ${weeksToRace} semanas hasta la prueba; se recomiendan al menos ${minimumPreparationWeeks} semanas conservadoras para esta distancia y nivel.`);
    warnings.push("El tiempo disponible parece insuficiente para desarrollar tolerancia con seguridad. Considera aplazar la fecha, elegir una distancia menor o quitar el objetivo de tiempo.");
  }
  if (distance >= 42 && (athleteLevel < 3 || weeksToRace < 20 || weeklyMinutes < 180)) {
    goalClass = "No recomendable actualmente";
    goalReasons.push("La carga reciente, el nivel o el tiempo disponible no alcanzan los requisitos mínimos conservadores para preparar maratón.");
    warnings.push("La meta de maratón requiere una preparación más extensa y una tolerancia semanal demostrada. Considera aplazarla, elegir una media maratón o plantearla sin objetivo temporal.");
  }
  if (!goalReasons.length) goalReasons.push("No existe una marca reciente comparable; se prescribe por RPE, conversación y tiempo, sin prometer un ritmo de carrera.");
  decisions.push({code:"GOAL_ASSESSED",ruleId:"GOAL-FEASIBILITY-001",reason:`Clasificación: ${goalClass}.`});

  const taperWeeks = distance >= 42 ? 3 : distance >= 21 ? 2 : 1;
  const usableWeeks = Math.max(1,weeksToRace-taperWeeks);
  const rawBaselineMinutes = weeklyMinutes > 0 ? weeklyMinutes : Math.max(45,runSlots.length*20);
  const baselineMinutes = rawBaselineMinutes*((recentPain||breakWeeks>=2||precautions)?0.8:1);
  const minimumQualityWeeks=distance>=21?10:distance>=10?7:6;
  const qualityAllowed = athleteLevel >= 3 && weeklyMinutes>=120 && !recentPain && !precautions && profile.trainingPriority!=="strength" && runningDayCount >= 3 && weeksToRace >= minimumQualityWeeks;
  const longRunSlot = runSlots.findIndex((slot)=>slot.longRun);
  const preferredLongSlot = longRunSlot >= 0 ? longRunSlot : runSlots.length-1;
  const longDay=runSlots[preferredLongSlot]?.day;
  const preferredQualitySlot = runSlots.findIndex((slot,index)=>index !== preferredLongSlot && !strengthDays.includes((slot.day+6)%7) && (slot.day+1)%7!==longDay && (slot.day+6)%7!==longDay);
  const qualitySlot = preferredQualitySlot >= 0 ? preferredQualitySlot : runSlots.findIndex((_,index)=>index !== preferredLongSlot);
  const protectedRunDays=new Set([longDay,...(qualitySlot>=0?[runSlots[qualitySlot].day]:[])].filter((day)=>day!==undefined));
  const sessions = [];

  let previousWeekMinutes=baselineMinutes;
  for (let week=0; week<totalWeeks; week++) {
    const isRaceWeek = week===weeksToRace-1;
    const postRaceWeek = week===weeksToRace;
    const inTaper = week>=weeksToRace-taperWeeks && week<weeksToRace;
    const deload = !postRaceWeek && !inTaper && week>0 && (week+1)%ALGORITHM_CONFIG.deloadEveryWeeks===0;
    const blockProgress = usableWeeks<=1 ? 1 : Math.min(1,week/(usableWeeks-1));
    const phase = postRaceWeek ? "Recuperación posobjetivo" : isRaceWeek ? "Competición" : inTaper ? "Taper" : deload ? "Descarga" : distance>=10 && blockProgress>0.72 ? "Específica" : blockProgress>0.45 && athleteLevel>=3 ? "Desarrollo" : athleteLevel<=1 ? "Adaptación correr/caminar" : "Base general";
    decisions.push({code:deload?"DELOAD_WEEK_ASSIGNED":inTaper?"TAPER_ASSIGNED":"TRAINING_PHASE_ASSIGNED",ruleId:deload?"LOAD-DELOAD-001":inTaper?"LOAD-TAPER-001":"PHASE-BASE-001",reason:`Semana ${week+1}: fase ${phase}${deload?", reducción de volumen del 25%":""}.`});
    const weekStart = new Date(start); weekStart.setDate(start.getDate()+week*7);
    const maxProgress = ALGORITHM_CONFIG.maximumWeeklyIncreasePctByLevel[athleteLevel];
    let targetWeekMinutes = postRaceWeek ? Math.min(60,baselineMinutes*0.3) : week===0 ? baselineMinutes : Math.min(previousWeekMinutes*(1+maxProgress),baselineMinutes*Math.pow(1+maxProgress,week));
    if (deload) targetWeekMinutes = previousWeekMinutes*(1-ALGORITHM_CONFIG.deloadReductionPct);
    if (isRaceWeek) targetWeekMinutes = Math.min(targetWeekMinutes,baselineMinutes*0.45);
    else if (inTaper) targetWeekMinutes = Math.min(targetWeekMinutes,baselineMinutes*0.65);
    previousWeekMinutes=targetWeekMinutes;
    const easySlots = runSlots.length;
    const distanceMode = profile.preferredRunningMetric === "distance";
    for (let runIndex=0; runIndex<runSlots.length; runIndex++) {
      if(postRaceWeek&&runIndex>0) continue;
      const slot=runSlots[runIndex];
      const date=dateAt(weekStart,slot.day);
      if((date>end&&!postRaceWeek) || isoDay(date)===goal.raceDate) continue;
      const isLong=!postRaceWeek&&runIndex===preferredLongSlot;
      const share=easySlots===1 ? 1 : isLong ? 0.34 : (0.66/Math.max(1,easySlots-1));
      let duration=Math.max(15,Math.round(targetWeekMinutes*share));
      if(athleteLevel===0) duration=Math.min(duration,30);
      if(athleteLevel===1) duration=Math.min(duration,40);
      if(isLong) {
        const longCap=Math.max(20,Math.min(180,Math.max(25,longestMinutes)*Math.pow(1+maxProgress,Math.min(week,4)),targetWeekMinutes*0.4));
        duration=Math.min(duration,longCap);
      }
      if(isRaceWeek) duration=Math.round(duration*0.65);
      else if(inTaper) duration=Math.round(duration*0.8);
      duration=Math.max(15,Math.min(duration,num(slot.maxSessionMinutes,num(profile.maxSessionMinutes,90))));
      const isQuality=!postRaceWeek&&qualityAllowed && duration>=40 && runIndex===qualitySlot && ["Base general","Desarrollo","Específica"].includes(phase) && !deload && !inTaper && week%2===1;
      const walkRun=!postRaceWeek&&(athleteLevel<=1 || (athleteLevel===2 && num(profile.continuousRunMinutes)<30));
      const includeStrides=!postRaceWeek&&!isQuality&&!isLong&&!deload&&!inTaper&&!walkRun&&athleteLevel>=2&&duration>=30&&runIndex!==qualitySlot&&week%3===1;
      const fasterLongFinish=!postRaceWeek&&isLong&&athleteLevel>=3&&weeklyMinutes>=150&&!recentPain&&!deload&&!inTaper&&week%4===2&&duration>=55;
      const effort=isQuality ? "RPE 6–8 · bloques controlados, nunca sprint" : deload ? "RPE 2–3 · muy fácil" : isLong ? "RPE 3–4 · conversación fluida" : "RPE 2–4 · conversación en frases completas";
      const easyPace=paceCue(recent5k,RUN_ZONES.easy,slot.mode);
      const recoveryPace=paceCue(recent5k,RUN_ZONES.recovery,slot.mode);
      const thresholdPace=paceCue(recent5k,RUN_ZONES.threshold,slot.mode);
      const intervalPace=paceCue(recent5k,RUN_ZONES.interval,slot.mode);
      const stridePace=paceCue(recent5k,RUN_ZONES.stride,slot.mode);
      const warmup=Math.max(10,Math.min(15,Math.round(duration*0.22)));
      const cooldown=Math.max(8,Math.min(12,Math.round(duration*0.18)));
      let work;
      let workoutKind="EASY_RUN";
      if(walkRun) {
        const runMinutes=Math.max(5,Math.round(duration*0.55));
        work=`Alterna 1–3 min de trote muy cómodo (${easyPace}) con 1–2 min caminando; acumula ${runMinutes} min de trote y completa ${duration} min totales caminando si hace falta. Mantén zancada natural y termina sin fatiga.`;
        workoutKind="RUN_WALK";
      } else if(isQuality) {
        const shortRace=distance<=5;
        const reps=shortRace?(duration>=52?6:5):(distance>=21?(duration>=58?4:3):4);
        const repMinutes=shortRace?2:distance>=21?6:4;
        const recoveryMinutes=shortRace?2:3;
        const intensity=shortRace?intervalPace:thresholdPace;
        const qualityLabel=shortRace?"intervalos aeróbicos cortos":"intervalos de umbral controlado";
        const qualityCore=reps*repMinutes+(reps-1)*recoveryMinutes;
        work=`Calentamiento: ${warmup} min de trote fácil (${easyPace}) + movilidad dinámica de tobillo/cadera y 3 progresivos de 15 s. Bloque principal: ${reps} × ${repMinutes} min ${qualityLabel} a ${intensity}; recupera ${recoveryMinutes} min trotando muy suave (${recoveryPace}) entre repeticiones. Enfría ${Math.max(cooldown,duration-warmup-qualityCore)} min muy suaves. Total aproximado: ${duration} min. Si el RPE supera 7 o se deteriora la técnica, termina el bloque y trota fácil.`;
        workoutKind=shortRace?"INTERVALS":"THRESHOLD";
      } else if(includeStrides) {
        const strideCount=week%2===1?6:4;
        const easyBlock=Math.max(12,duration-warmup-cooldown-strideCount*0.33-strideCount*1.25);
        work=`${warmup} min de calentamiento fácil (${easyPace}); continúa hasta completar ${Math.round(easyBlock)} min de carrera fácil. Después haz ${strideCount} × 20 s progresivos ágiles (${stridePace}), recuperando 75–90 s caminando o trotando muy suave entre ellos. Acaba con ${cooldown} min suaves. Los progresivos son relajados, sin esprintar.`;
        workoutKind="STRIDES";
      } else if(isLong) {
        const easyLong=duration-(fasterLongFinish?12:0);
        work=`Tirada larga de ${duration} min: primeros 15 min muy cómodos (${recoveryPace}); completa el resto a ritmo fácil (${easyPace}), RPE 3–4, sin acelerar para recuperar sesiones perdidas.${fasterLongFinish?` Si al minuto ${easyLong} mantienes RPE ≤4 y técnica fluida, termina con 12 min sostenidos (RPE 5, ${paceCue(recent5k,RUN_ZONES.steady,slot.mode)}); si no, conserva todo fácil.`:""}`;
        workoutKind=fasterLongFinish?"PROGRESSIVE_LONG_RUN":"LONG_RUN";
      } else {
        const pace=deload?recoveryPace:easyPace;
        work=postRaceWeek
          ? `Recuperación flexible: 20–30 min caminando o trotando muy suave (${recoveryPace}); solo si no hay dolor, enfermedad ni fatiga inusual. También puedes descansar por completo.`
          : `${deload?"Rodaje de descarga":"Rodaje fácil continuo"}: ${duration} min a ${pace}. Mantén conversación completa, sin bloques rápidos; acaba con sensación de poder continuar otros 10 min. Si no dispones de marca reciente, guía toda la sesión por RPE 2–4.`;
        workoutKind=postRaceWeek?"RECOVERY":deload?"DELOAD_RUN":"EASY_RUN";
      }
      const pace=recent5k>0 ? recent5k/5*1.22 : 7.2;
      const km=distanceMode ? Math.round(duration/pace*10)/10 : undefined;
      sessions.push({
        id:`w${week}-r${runIndex}-${slot.mode}`,date:isoDay(date),day:weekDays[slot.day],week:week+1,phase,type:"run",
        category:workoutKind,
        title:postRaceWeek?"Recuperación posobjetivo":isLong?(fasterLongFinish?"Tirada larga progresiva":"Tirada larga aeróbica"):walkRun?"Carrera y caminata":isQuality?(distance<=5?"Intervalos aeróbicos":"Umbral controlado"):includeStrides?"Rodaje fácil + progresivos":deload?"Rodaje de descarga":"Rodaje fácil",
        ...(km ? {distanceKm:km}:{}),durationMin:duration,effort,
        details:`${work}. ${slot.mode==="treadmill" ? "Cinta: inclinación cómoda entre 0–1%; ajusta en incrementos pequeños y manda el RPE si calor o pulso se elevan. No te agarres a la máquina." : `Exterior${goal.terrain&&goal.terrain!=="road"?` · terreno objetivo: ${goal.terrain}`:""}: elige una superficie segura y regula por esfuerzo en cuestas o calor.`}${recent5k?" Rangos de ritmo derivados de una marca 5K fechada; son orientativos y prevalece el esfuerzo percibido.":" Sin marca 5K reciente: utiliza los tiempos y rangos de RPE indicados, sin perseguir una velocidad inventada."}`,
        status:"pending",environment:slot.mode,sessionLoad:duration*(isQuality?6:3),impactLoad:duration*(slot.mode==="outdoor"?1:0.85)*(isQuality?1.25:1),load:{cardiovascular:duration*(isQuality?6:3),impact:duration*(slot.mode==="outdoor"?1:0.85)*(isQuality?1.25:1),neuromuscular:duration*(isQuality?0.8:0.35),strength:0},
      });
    }
    const strengthLimit=postRaceWeek||isRaceWeek ? 0 : inTaper ? 1 : strengthDays.length;
    for(const [strengthIndex,day] of strengthDays.slice(0,strengthLimit).entries()) {
      const date=dateAt(weekStart,day); if((date>end&&!postRaceWeek)||isoDay(date)===goal.raceDate) continue;
      const {division,exercises,prescriptions}=strengthRoutine(strengthConfig,week,strengthIndex,strengthDays,catalog,day,protectedRunDays);
      const baseSets=deload||inTaper?2:athleteLevel<=1?2:3;
      const prescription=exercises.length?exercises.map((exercise)=>{
        const item=prescriptions[exercise]||{target:null,main:false,reps:"8–12"};
        const sets=item.main?baseSets:Math.max(1,baseSets-1);
        return `${item.target?`${item.target} — `:""}${exercise} · ${sets} × ${item.reps}`;
      }).join("; "):"Sin ejercicios seleccionados para este día de la división configurada; revisa la selección de fuerza en Administración.";
      const totalStrengthSets=exercises.reduce((sum,exercise)=>sum+((prescriptions[exercise]?.main?baseSets:Math.max(1,baseSets-1))||0),0);
      const strengthDuration=Math.max(15,Math.min(40,num(schedule[day]?.maxSessionMinutes,num(profile.maxSessionMinutes,90))));
      sessions.push({id:`w${week}-s${day}`,date:isoDay(date),day:weekDays[day],week:week+1,phase,type:"strength",category:"STRENGTH",title:`Fuerza · ${division}`,durationMin:strengthDuration,effort:`RIR ${ALGORITHM_CONFIG.strength.targetRIR[0]}–${ALGORITHM_CONFIG.strength.targetRIR[1]} · técnica estable, sin fallo`,details:`${prescription}. Descansa 90–120 s en ejercicios principales y 60–90 s en accesorios. Progresa primero en técnica y repeticiones; no aumentes series y carga a la vez. En días compartidos, corre primero si hay sesión clave.`,status:"pending",sessionLoad:strengthDuration*5,neuromuscularLoad:totalStrengthSets,load:{cardiovascular:strengthDuration*5,impact:0,neuromuscular:totalStrengthSets*8,strength:strengthDuration*5}});
    }
    if(isRaceWeek) {
      const racePace=goalClass!=="No recomendable actualmente"&&targetTime?targetTime/distance:recent5k?recent5k*Math.pow(distance/5,ALGORITHM_CONFIG.riegelExponentByLevel[athleteLevel])/distance:null;
      const raceCue=racePace?(goal.terrain==="treadmill"?speedText(racePace*60):`${paceText(racePace*60)} min/km`):"RPE 5–7, empezando controlado";
      sessions.push({id:`w${week}-race`,date:goal.raceDate,day:weekDays[(targetDate.getDay()+6)%7],week:week+1,phase:"Competición",type:"race",category:"RACE",title:`${distance} km · día del objetivo`,distanceKm:distance,durationMin:targetTime||null,effort:"Controlado · prioriza terminar con buenas sensaciones",details:`Calentamiento: 10–15 min de trote fácil, movilidad dinámica y 3–4 progresivos de 15–20 s; termina 3–5 min antes de la salida. Empieza conservador (${raceCue}) y ajusta por RPE, terreno y clima. No fuerces el objetivo de tiempo si no es realista, aparece dolor o la respiración/técnica se deterioran. Al terminar, camina 8–10 min y rehidrátate.`,status:"pending"});
    }
  }
  for(const [date,daySessions] of Map.groupBy(sessions,(session)=>session.date)) {
    const sessionDate=new Date(`${date}T12:00:00`);
    const dayIndex=(sessionDate.getDay()+6)%7;
    const dayCap=num(schedule[dayIndex]?.maxSessionMinutes,num(profile.maxSessionMinutes,90));
    let excess=daySessions.reduce((sum,session)=>sum+Number(session.durationMin||0),0)-dayCap;
    if(excess<=0) continue;
    for(const session of [...daySessions].sort((a,b)=>(a.type==="strength"?-1:1)-(b.type==="strength"?-1:1))) {
      if(excess<=0) break;
      const reducible=Math.max(0,Number(session.durationMin||0)-15);
      const reduction=Math.min(excess,reducible);
      scalePlannedSession(session,Number(session.durationMin||0)-reduction);
      excess-=reduction;
    }
    if(excess>0) {
      const optional=daySessions.filter((session)=>session.type==="strength"||session.category==="EASY_RUN"||session.category==="THRESHOLD").sort((a,b)=>(a.type==="strength"?-1:1)-(b.type==="strength"?-1:1));
      for(const session of optional) {
        if(excess<=0) break;
        if(session.status==="pending") { session.status="skipped"; session.safetyAction="Sesión omitida para respetar la duración máxima disponible ese día."; session.adaptation="SESSION_REMOVED · SCHEDULE-DAILY-LIMIT-001"; excess-=Number(session.durationMin||0); }
      }
    }
    warnings.push(`La duración disponible de ${weekDays[dayIndex]} limita las sesiones programadas ese día.`);
    decisions.push({code:"DAILY_DURATION_LIMIT_APPLIED",ruleId:"SCHEDULE-DAILY-LIMIT-001",reason:`La duración conjunta del ${weekDays[dayIndex]} se ajustó al máximo de ${dayCap} minutos.`});
  }
  sessions.sort((a,b)=>a.date.localeCompare(b.date)||(profile.trainingPriority==="strength"?(a.type==="strength"?-1:1)-(b.type==="strength"?-1:1):(a.type==="run"?-1:1)-(b.type==="run"?-1:1)));
  const notes=[`Algoritmo ${ALGORITHM_VERSION} · reglas ${RULESET_VERSION}. Nivel estimado: ${athleteLevel} (${levelName}); los datos recientes prevalecen sobre la autodeclaración de experiencia.`,`Progresión por minutos limitada a un máximo configurado de ${athleteLevel<=2?5:athleteLevel===3?7:8}% por semana; descarga periódica del 25%; la sesión perdida no se recupera acumulándola.`,`Mayoría de sesiones de carrera a RPE 2–4. En cinta, la prescripción se basa en tiempo y percepción del esfuerzo.`,`Los ejercicios de fuerza proceden exclusivamente del catálogo seleccionado por el administrador y respetan la división ${strengthConfig.division}.`,`Revisa sueño, fatiga, estrés, enfermedad y dolor antes de cada entrenamiento. Cancela ante fiebre, dolor agudo/progresivo, alteración de marcha, mareo, dolor torácico o falta de aire anormal.`];
  if(precautions) notes.push("Señal de precaución: utiliza una carga reducida y consulta con un profesional sanitario si corresponde.");
  const inputSnapshot={profile:{age:profile.age,runningExperienceMonths:profile.runningExperienceMonths,currentWeeklyRuns:weeklyRuns,currentWeeklyMinutes:weeklyMinutes,longestRunLast28DaysMinutes:longestMinutes,weeksSinceTraining:breakWeeks,preferredRunningMetric:profile.preferredRunningMetric,trainingPriority:profile.trainingPriority,gymAccess:profile.gymAccess,healthScreening:profile.healthScreening,precautionScreening:profile.precautionScreening,recoveryProfile:profile.recoveryProfile,trainingSchedule:schedule},goal:{...goal},strengthConfig:{division:strengthConfig.division,exercises:[...(strengthConfig.exercises||[])]}};
  const alternatives=[];
  if(goalClass==="No recomendable actualmente") alternatives.push("Prioridad: completar con salud, sin marca temporal","Elegir una fecha posterior para ampliar la preparación",...(distance>=42?["Preparar primero una media maratón"]:distance>=21?["Elegir una distancia intermedia"]:[]));
  if(goal.terrain==="trail"||num(goal.elevationGainM)>300) warnings.push("El terreno o desnivel del objetivo puede aumentar la carga de impacto; el plan prescribe por RPE y no estima equivalencias de ritmo.");
  const predictedRangeMin=predictedTimeMin?{lower:Math.round(predictedTimeMin*0.95),central:Math.round(predictedTimeMin),upper:Math.round(predictedTimeMin*1.15)}:null;
  return {version,algorithmVersion:ALGORITHM_VERSION,rulesetVersion:RULESET_VERSION,rulesReviewed: RULES_REVIEWED,generatedAt:now.toISOString(),inputSnapshot,athleteLevel,goalAssessment:{classification:goalClass,reasons:goalReasons,predictedTimeMin,predictedRangeMin,alternatives},warnings:[...new Set(warnings)],decisions,runningMetric:profile.preferredRunningMetric||"time",goal,weeks:totalWeeks,sessions,notes};
}

const SUPPORTED_RACE_DISTANCES = new Set([5, 10, 21.097]);

function weeksUntilGoal(goalDate, now) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${goalDate}T00:00:00`);
  return Number.isNaN(target.getTime()) ? 0 : Math.floor((target - today) / 604800000);
}

function preparationWeeks(distance, level) {
  const restarting = level <= 1;
  if (distance === 5) return restarting ? 12 : 8;
  if (distance === 10) return restarting ? 16 : 10;
  return restarting ? 20 : 12;
}

export function getPlanEligibility(profile, goal, now = new Date(), history = []) {
  const distance = Number(goal?.distanceKm);
  const targetDate = goal?.raceDate || "";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const slots = (profile?.trainingSchedule || []).flatMap((day, index) => {
    const maxSessionMinutes = num(day?.maxSessionMinutes, num(profile?.maxSessionMinutes, 90));
    if (maxSessionMinutes < 30) return [];
    if (day?.street && day?.treadmill && maxSessionMinutes < 60) return [];
    return [
      ...(day?.street ? [{ day: index, environment: "outdoor", cap: maxSessionMinutes }] : []),
      ...(day?.treadmill ? [{ day: index, environment: "treadmill", cap: maxSessionMinutes }] : []),
    ];
  });
  const runDays = new Set(slots.map((slot) => slot.day));
  const manualRuns = num(profile?.currentWeeklyRuns, 0);
  const weeklyMinutes = num(profile?.currentWeeklyMinutes, 0) || num(profile?.weeklyKm, 0) * 7.2;
  const recentLongest = history.filter((activity) => activity.type === "run" && activity.date >= isoDay(new Date(today.getTime() - 56 * 86400000))).reduce((max, activity) => Math.max(max, num(activity.durationMin, 0)), 0);
  const longestMinutes = Math.max(num(profile?.longestRunMinutes, 0), num(profile?.longestRunKm, 0) * 7.2, recentLongest);
  const recentPain = history.some((activity) => activity.type === "run" && activity.date >= isoDay(new Date(today.getTime() - 56 * 86400000)) && (activity.soreness || activity.painWorsening || activity.painChangesGait));
  const level = classifyAthlete(profile || {}, {
    weeklyRuns: manualRuns,
    weeklyMinutes,
    longestMinutes,
    breakWeeks: num(profile?.weeksSinceTraining, 0),
    recentPain,
  });
  const minimumWeeks = preparationWeeks(distance, level);
  const weeks = weeksUntilGoal(targetDate, now);
  const minimumRunDays = distance === 21.097 ? 3 : 2;
  const problems = [];
  if (!SUPPORTED_RACE_DISTANCES.has(distance)) problems.push("Elige 5K, 10K o media maratón.");
  if (num(profile?.age, 0) < 18 || num(profile?.age, 0) > 100) problems.push("El planificador está disponible únicamente para personas adultas; revisa la edad del perfil.");
  if (runDays.size < minimumRunDays) problems.push(`Para esta distancia hacen falta al menos ${minimumRunDays} días de carrera disponibles con 30 minutos o más.`);
  if (weeks < minimumWeeks) problems.push(`Para preparar esta meta recomendamos al menos ${minimumWeeks} semanas con tu base actual.`);
  if (targetDate && weeksUntilGoal(targetDate, now) < 1) problems.push("La fecha de la carrera debe estar al menos a una semana.");
  return {
    eligible: problems.length === 0,
    distance,
    level,
    minimumWeeks,
    weeksAvailable: weeks,
    minimumRunDays,
    scheduledRunDays: runDays.size,
    problems,
  };
}

function roundedDownFive(value) {
  return Math.max(0, Math.floor(Number(value) / 5) * 5);
}

function raceMarkForGoal(profile, distance, today) {
  const marks = [
    { distance: 5, minutes: num(profile.recent5kMin), date: profile.recent5kDate },
    { distance: 10, minutes: num(profile.recent10kMin), date: profile.recent10kDate },
    { distance: 21.097, minutes: num(profile.recentHalfMin), date: profile.recentHalfDate },
  ].filter((mark) => {
    if (!(mark.minutes > 0) || !mark.date) return false;
    const ageDays = Math.floor((today - new Date(`${mark.date}T00:00:00`)) / 86400000);
    return ageDays >= 0 && ageDays <= 84;
  });
  marks.sort((a, b) => Math.abs(a.distance - distance) - Math.abs(b.distance - distance) || b.date.localeCompare(a.date));
  return marks[0] || null;
}

function buildRunDetails({ duration, quality, distance, pace, zone }) {
  const warmup = 10;
  const cooldown = 10;
  const core = quality
    ? distance === 5
      ? { reps: 5, work: 2, rest: 2, rpe: "RPE 7" }
      : distance === 10
        ? { reps: 3, work: 6, rest: 3, rpe: "RPE 6–7" }
        : { reps: 2, work: 10, rest: 3, rpe: "RPE 5–6" }
    : null;
  const qualityMinutes = core ? core.reps * core.work + (core.reps - 1) * core.rest : 0;
  const easyMainMinutes = Math.max(0, duration - warmup - cooldown - qualityMinutes);
  let details;
  if (core) {
    details = `Calentamiento fácil: ${warmup} min. Después, ${easyMainMinutes} min fáciles${easyMainMinutes ? " antes del bloque principal" : ""}. Bloque principal: ${core.reps} × ${core.work} min (${core.rpe}${pace ? `; referencia ${pace}` : "; sin ritmo objetivo, usa el RPE"}), con ${core.rest} min muy suaves entre repeticiones. Enfriamiento fácil: ${cooldown} min. Total: ${warmup + easyMainMinutes + qualityMinutes + cooldown} min.`;
  } else {
    const mainLabel = zone === "recovery" ? "muy suave (RPE 2–3)" : "fácil, conversación completa (RPE 2–4)";
    details = `Calentamiento muy fácil: ${warmup} min. Bloque principal: ${duration - warmup - cooldown} min ${mainLabel}${pace ? `; rango orientativo ${pace}` : "; sin ritmo objetivo numérico"}. Enfriamiento fácil: ${cooldown} min. Total: ${duration} min.`;
  }
  return { details, qualityMinutes, easyMainMinutes };
}

function runEnvironmentDetails(mode, goal, mark) {
  if (mode === "treadmill") return "CINTA: sigue la velocidad orientativa solo si la máquina está familiarizada y prevalece el RPE. Usa la pendiente elegida; 0–1% es opcional, no una conversión obligatoria. Asegura la pinza de seguridad.";
  return `EXTERIOR: usa RPE como referencia principal. ${goal.terrain && goal.terrain !== "road" ? `Terreno objetivo: ${goal.terrain}. ` : ""}En cuestas, viento o calor no persigas el ritmo llano.${mark ? ` Ritmo calculado desde marca de ${mark.distance} km (${mark.date}); orientativo.` : " Sin marca reciente válida: no hay ritmo numérico prescrito."}`;
}

export function refreshRunSessionPrescription(session, duration, goal) {
  const roundedDuration = Math.max(30, roundedDownFive(duration));
  const isQuality = ["INTERVALS", "THRESHOLD"].includes(session.category);
  const targetDistance = Number(session.trainingDistanceKm || goal?.distanceKm || 5);
  const { details } = buildRunDetails({
    duration: roundedDuration,
    quality: isQuality,
    distance: targetDistance,
    pace: session.paceReference || null,
    zone: session.category === "DELOAD_RUN" ? "recovery" : "easy",
  });
  session.durationMin = roundedDuration;
  session.details = `${details} ${runEnvironmentDetails(session.environment, goal || {}, session.referenceMark || null)}`;
  return session;
}

export function generateHybridPlan(profile, goal, version, strengthConfig, catalog, history = [], now = new Date()) {
  if (!profile || !goal) throw Object.assign(new Error("Completa primero el perfil y el objetivo."), { status: 400 });
  const eligibility = getPlanEligibility(profile, goal, now, history);
  if (!eligibility.eligible) {
    throw Object.assign(new Error(eligibility.problems.join(" ")), { status: 400, eligibility });
  }

  const targetDate = new Date(`${goal.raceDate}T00:00:00`);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const distance = Number(goal.distanceKm);
  const schedule = profile.trainingSchedule || [];
  const warnings = [];
  const decisions = [];
  const last56 = history.filter((activity) => activity.type === "run" && activity.date >= isoDay(new Date(today.getTime() - 56 * 86400000)));
  const recentPain = last56.some((activity) => Boolean(activity.soreness) || Boolean(activity.painWorsening) || Boolean(activity.painChangesGait));
  const weeklyRuns = num(profile.currentWeeklyRuns, 0);
  const weeklyMinutes = num(profile.currentWeeklyMinutes, 0) || num(profile.weeklyKm, 0) * 7.2;
  const recentLongest = last56.reduce((max, activity) => Math.max(max, num(activity.durationMin, 0)), 0);
  const longestMinutes = Math.max(num(profile.longestRunMinutes, 0), num(profile.longestRunKm, 0) * 7.2, recentLongest);
  const breakWeeks = num(profile.weeksSinceTraining, 0);
  const athleteLevel = classifyAthlete(profile, { weeklyRuns, weeklyMinutes, longestMinutes, breakWeeks, recentPain });
  const levelName = ["Reinicio", "Reinicio", "Principiante", "Intermedio", "Avanzado"][athleteLevel];
  const runSlots = schedule.flatMap((day, index) => {
    const cap = num(day?.maxSessionMinutes, num(profile.maxSessionMinutes, 90));
    const selected = [
      ...(day?.street ? [{ day: index, mode: "outdoor", longRun: Boolean(day.longRun), maxSessionMinutes: cap }] : []),
      ...(day?.treadmill ? [{ day: index, mode: "treadmill", longRun: false, maxSessionMinutes: cap }] : []),
    ];
    if (selected.length > 1 && cap < 60) {
      warnings.push(`${weekDays[index]} tiene cinta y calle seleccionadas, pero el límite de ${cap} min no permite programar ambas sesiones de 30 min; se omiten las dos carreras de ese día.`);
      return [];
    }
    if (selected.length && cap < 30) warnings.push(`${weekDays[index]} permite menos de 30 min; no se programa carrera ese día.`);
    return selected.filter((slot) => slot.maxSessionMinutes >= 30);
  });
  const runnableDays = new Set(runSlots.map((slot) => slot.day));
  const longSlot = runSlots.findIndex((slot) => slot.mode === "outdoor" && slot.longRun);
  const strengthDays = schedule.map((day, index) => day?.strength ? index : -1).filter((index) => index >= 0);
  const precaution = Object.values(profile.precautionScreening || {}).some(Boolean);
  const recovery = profile.recoveryProfile || {};
  const poorRecovery = num(recovery.sleepQuality, 3) <= 1 || num(recovery.stress, 2) >= 5 || num(recovery.sleepHours, 7) < 5;
  if (recentPain) warnings.push("El historial de las últimas ocho semanas contiene molestias; se omiten las sesiones de calidad.");
  if (poorRecovery || precaution) warnings.push("Los datos de recuperación o salud aconsejan mantener una carga conservadora y priorizar RPE.");
  if (!weeklyMinutes) warnings.push("Falta una carga semanal declarada; se parte de 30 min por sesión seleccionada y se prioriza RPE.");

  const historyForPaces = raceMarkForGoal(profile, distance, today);
  const riegelExponent = ALGORITHM_CONFIG.riegelExponentByLevel[athleteLevel];
  const equivalent5k = historyForPaces ? historyForPaces.minutes * Math.pow(5 / historyForPaces.distance, riegelExponent) : 0;
  const reference5kDate = historyForPaces?.date || null;
  const targetPrediction = historyForPaces ? historyForPaces.minutes * Math.pow(distance / historyForPaces.distance, riegelExponent) : null;
  const targetTime = num(goal.targetTimeMin, 0);
  let goalClass = targetPrediction ? "Realista" : "No evaluable por falta de marca fechada reciente";
  if (targetPrediction && targetTime) {
    goalClass = targetTime < targetPrediction * 0.92 ? "No recomendable actualmente" : targetTime < targetPrediction * 1.02 ? "Ambicioso" : targetTime <= targetPrediction * 1.25 ? "Realista" : "Conservador";
  }
  const goalReasons = historyForPaces
    ? [`Estimación orientativa derivada de una marca de ${historyForPaces.distance} km del ${historyForPaces.date}; no garantiza el resultado.`]
    : ["No hay una marca fechada de hasta 12 semanas; la intensidad se prescribe por RPE y talk test."];
  const predictedTimeMin = targetPrediction ? Math.round(targetPrediction) : null;
  const predictedRangeMin = targetPrediction ? { lower: Math.round(targetPrediction * 0.95), central: Math.round(targetPrediction), upper: Math.round(targetPrediction * 1.15) } : null;
  if (goalClass === "No recomendable actualmente") warnings.push("El tiempo elegido es más ambicioso que la estimación orientativa; prioriza completar con control o cambia el objetivo.");
  decisions.push({ code: "ATHLETE_LEVEL_CLASSIFIED", ruleId: "PROFILE-LEVEL-002", reason: `Nivel ${athleteLevel} (${levelName}) a partir del resumen manual reciente y continuidad; las actividades complementan molestias y tirada larga.` });
  decisions.push({ code: "GOAL_ASSESSED", ruleId: "GOAL-FEASIBILITY-002", reason: `Clasificación del objetivo: ${goalClass}.` });

  const weekStart = mondayOf(today);
  const raceWeekIndex = Math.floor((targetDate - weekStart) / 604800000);
  const taperWeeks = distance === 21.097 ? 2 : 1;
  const totalWeeks = raceWeekIndex + 2;
  let baselineMinutes = weeklyMinutes > 0 ? weeklyMinutes : runSlots.length * 30;
  if (recentPain || poorRecovery || precaution || breakWeeks >= 2) baselineMinutes *= 0.8;
  baselineMinutes = roundedDownFive(baselineMinutes);
  const maxProgress = ALGORITHM_CONFIG.maximumWeeklyIncreasePctByLevel[athleteLevel] ?? 0;
  const markedLongMinutes = longSlot >= 0 ? Math.max(0, longestMinutes) : 0;
  const qualityAllowed = athleteLevel >= 2 && weeklyMinutes >= 90 && !recentPain && !poorRecovery && !precaution && profile.trainingPriority !== "strength" && runnableDays.size >= 2;
  const sessions = [];
  const previousWeekMinutes = [];
  const buildWeeks = Math.max(1, raceWeekIndex - taperWeeks + 1);
  const reducedSlotsByWeek = new Map();

  for (let week = 0; week <= raceWeekIndex; week++) {
    const isRaceWeek = week === raceWeekIndex;
    const taperOffset = raceWeekIndex - week;
    const inTaper = taperOffset < taperWeeks;
    const deload = !inTaper && week > 0 && week % ALGORITHM_CONFIG.deloadEveryWeeks === ALGORITHM_CONFIG.deloadEveryWeeks - 1;
    const phase = isRaceWeek ? "Competición" : inTaper ? "Afinamiento" : deload ? "Descarga" : week < 2 ? "Base" : week < buildWeeks * 0.55 ? "Desarrollo" : "Específica";
    let weeklyTarget = week === 0 ? baselineMinutes : Math.min(previousWeekMinutes.at(-1) * (1 + maxProgress), baselineMinutes * Math.pow(1 + maxProgress, week));
    weeklyTarget = roundedDownFive(weeklyTarget);
    if (deload) weeklyTarget = roundedDownFive(previousWeekMinutes.at(-1) * (1 - ALGORITHM_CONFIG.deloadReductionPct));
    if (inTaper) {
      const reduction = distance === 21.097 && taperOffset === 1 ? 0.8 : 0.6;
      weeklyTarget = Math.min(weeklyTarget, roundedDownFive(baselineMinutes * reduction));
    }
    previousWeekMinutes.push(weeklyTarget);
    decisions.push({ code: deload ? "DELOAD_WEEK_ASSIGNED" : inTaper ? "TAPER_WEEK_ASSIGNED" : "TRAINING_PHASE_ASSIGNED", ruleId: deload ? "LOAD-DELOAD-002" : inTaper ? "LOAD-TAPER-002" : "PHASE-RUN-002", reason: `Semana ${week + 1}: ${phase}; objetivo de carrera ${weeklyTarget} min antes de aplicar disponibilidad diaria.` });

    const dayGroups = [...Map.groupBy(runSlots, (slot) => slot.day).entries()]
      .sort((a, b) => Number(b[1].some((slot) => slot.longRun)) - Number(a[1].some((slot) => slot.longRun)) || a[0] - b[0]);
    let minutesAvailable = weeklyTarget;
    const weekSlots = [];
    for (const [, dayGroup] of dayGroups) {
      const groupMinimum = dayGroup.length * 30;
      if (minutesAvailable >= groupMinimum) {
        weekSlots.push(...dayGroup);
        minutesAvailable -= groupMinimum;
      } else {
        reducedSlotsByWeek.set(week, (reducedSlotsByWeek.get(week) || 0) + dayGroup.length);
      }
    }
    const weekLongSlot = weekSlots.findIndex((slot) => slot.longRun);
    const weekQualitySlot = weekSlots.findIndex((slot, index) => index !== weekLongSlot && !weekSlots.some((candidate) => candidate.longRun && candidate.day === slot.day));
    const weights = weekSlots.map((slot, index) => index === weekLongSlot ? 0.34 : weekSlots.length === 1 ? 1 : 0.66 / Math.max(1, weekSlots.length - (weekLongSlot >= 0 ? 1 : 0)));
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const durationCaps = weekSlots.map((slot, index) => {
      let cap = roundedDownFive(slot.maxSessionMinutes);
      if (index === weekLongSlot && markedLongMinutes > 0) {
        const progressionCap = markedLongMinutes * Math.pow(1 + maxProgress, Math.min(week, 4));
        cap = Math.min(cap, roundedDownFive(progressionCap), roundedDownFive(weeklyTarget * 0.35));
      }
      return cap;
    });
    const weekDurations = weekSlots.map((slot, index) => Math.min(durationCaps[index], 30 + roundedDownFive(minutesAvailable * weights[index] / weightTotal)));
    let unallocatedMinutes = weeklyTarget - weekDurations.reduce((sum, duration) => sum + duration, 0);
    while (unallocatedMinutes >= 5) {
      let allocated = false;
      for (let index = 0; index < weekDurations.length && unallocatedMinutes >= 5; index++) {
        if (weekDurations[index] + 5 <= durationCaps[index]) {
          weekDurations[index] += 5;
          unallocatedMinutes -= 5;
          allocated = true;
        }
      }
      if (!allocated) break;
    }
    const weekStartDate = new Date(weekStart);
    weekStartDate.setDate(weekStart.getDate() + week * 7);
    const qualityDays = new Set();
    const generatedThisWeek = [];

    for (let index = 0; index < weekSlots.length; index++) {
      const slot = weekSlots[index];
      const date = dateAt(weekStartDate, slot.day);
      if (date < today || date > targetDate || isoDay(date) === goal.raceDate) continue;
      const duration = weekDurations[index];
      if (duration < 30) {
        reducedSlotsByWeek.set(week, (reducedSlotsByWeek.get(week) || 0) + 1);
        continue;
      }

      const dayHasLong = weekSlots.some((candidate, candidateIndex) => candidateIndex === weekLongSlot && candidate.day === slot.day);
      const isQuality = qualityAllowed && !inTaper && !deload && week >= 2 && index === weekQualitySlot && duration >= (distance === 5 ? 40 : 45) && !dayHasLong && !qualityDays.has(slot.day);
      if (isQuality) qualityDays.add(slot.day);
      const zone = isQuality ? "threshold" : deload ? "recovery" : "easy";
      const pace = equivalent5k ? paceCue(equivalent5k, isQuality && distance === 5 ? RUN_ZONES.interval : RUN_ZONES[zone], slot.mode) : null;
      const { details } = buildRunDetails({ duration, quality: isQuality, distance, pace, zone });
      const isLong = index === weekLongSlot;
      const qualityKind = distance === 5 ? "INTERVALS" : "THRESHOLD";
      const dateIso = isoDay(date);
      const session = {
        id: `w${week + 1}-r${index}-${slot.mode}`,
        date: dateIso,
        day: weekDays[slot.day],
        week: week + 1,
        phase,
        type: "run",
        category: isQuality ? qualityKind : isLong ? "LONG_RUN" : deload ? "DELOAD_RUN" : "EASY_RUN",
        title: isQuality ? distance === 5 ? "Intervalos controlados" : "Bloques específicos controlados" : isLong ? "Tirada larga fácil" : deload ? "Rodaje fácil de descarga" : "Rodaje fácil",
        durationMin: duration,
        effort: isQuality ? distance === 5 ? "RPE 7 · rápido controlado, nunca sprint" : distance === 10 ? "RPE 6–7 · exigente pero sostenible" : "RPE 5–6 · controlado" : deload ? "RPE 2–3 · conversación completa" : "RPE 2–4 · conversación completa",
        details: `${details} ${runEnvironmentDetails(slot.mode, goal, historyForPaces)}`,
        status: "pending",
        environment: slot.mode,
        trainingDistanceKm: distance,
        paceReference: pace,
        referenceMark: historyForPaces,
        ...(!isQuality && equivalent5k && profile.preferredRunningMetric === "distance" ? { distanceKm: Math.round(duration / (equivalent5k * 1.22 / 5) * 10) / 10 } : {}),
        sessionLoad: duration * (isQuality ? 6 : 3),
        impactLoad: duration * (slot.mode === "outdoor" ? 1 : 0.85) * (isQuality ? 1.25 : 1),
        load: { cardiovascular: duration * (isQuality ? 6 : 3), impact: duration * (slot.mode === "outdoor" ? 1 : 0.85) * (isQuality ? 1.25 : 1), neuromuscular: duration * (isQuality ? 0.8 : 0.35), strength: 0 },
      };
      generatedThisWeek.push(session);
    }

    for (const [date, daySessions] of Map.groupBy(generatedThisWeek, (session) => session.date)) {
      const dayIndex = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
      const cap = num(schedule[dayIndex]?.maxSessionMinutes, num(profile.maxSessionMinutes, 90));
      let sum = daySessions.reduce((total, session) => total + session.durationMin, 0);
      const discardOrder = [...daySessions].sort((a, b) => {
        const priority = (session) => session.category === "EASY_RUN" || session.category === "DELOAD_RUN" ? 0 : session.category === "LONG_RUN" ? 1 : 2;
        return priority(a) - priority(b) || b.id.localeCompare(a.id);
      });
      for (const session of discardOrder) {
        if (sum <= cap) break;
        generatedThisWeek.splice(generatedThisWeek.indexOf(session), 1);
        sum -= session.durationMin;
        reducedSlotsByWeek.set(week, (reducedSlotsByWeek.get(week) || 0) + 1);
      }
    }
    sessions.push(...generatedThisWeek);
  }

  const raceDayIndex = (targetDate.getDay() + 6) % 7;
  sessions.push({
    id: `w${raceWeekIndex + 1}-race`,
    date: goal.raceDate,
    day: weekDays[raceDayIndex],
    week: raceWeekIndex + 1,
    phase: "Competición",
    type: "race",
    category: "RACE",
    title: `${distance === 21.097 ? "Media maratón" : `${distance}K`} · objetivo`,
    distanceKm: distance,
    durationMin: targetTime || null,
    effort: targetTime ? "Controlado; el esfuerzo y las condiciones prevalecen sobre el tiempo objetivo" : "RPE 5–7; empieza controlado y prioriza completar con buenas sensaciones",
    details: `Calentamiento fijo: 10 min muy fáciles antes de la salida. Usa el ritmo objetivo solo como referencia si procede y regula por RPE, clima y terreno. Después de la meta, 10 min caminando o muy suave como transición opcional. La duración de carrera indicada no incluye calentamiento ni enfriamiento.`,
    status: "pending",
    environment: goal.terrain === "treadmill" ? "treadmill" : "outdoor",
  });

  const strengthPlan = buildStrengthSessions({
    profile,
    goal,
    schedule,
    runSessions: sessions.filter((session) => session.type === "run"),
    strengthConfig,
    catalog,
    raceWeekIndex,
    totalWeeks,
    today,
    recovery: { poorRecovery, precaution, recentPain },
  });
  sessions.push(...strengthPlan.sessions);
  warnings.push(...strengthPlan.warnings);
  decisions.push(...strengthPlan.decisions);

  for (const [week, skipped] of reducedSlotsByWeek) {
    if (skipped) warnings.push(`En la semana ${week + 1} se omitieron ${skipped} sesiones para respetar el mínimo de 30 min y los límites diarios.`);
  }
  if (longSlot < 0) warnings.push("No se ha marcado una tirada larga exterior; todas las salidas se prescriben como sesiones normales.");
  if (goal.terrain === "trail" || num(goal.elevationGainM) > 300) warnings.push("El terreno o desnivel del objetivo puede cambiar el esfuerzo; regula por RPE y no se estima equivalencia de ritmo.");
  sessions.sort((a, b) => a.date.localeCompare(b.date) || (a.type === "race" ? 1 : b.type === "race" ? -1 : (a.environment === "outdoor" ? 0 : 1) - (b.environment === "outdoor" ? 0 : 1)) || a.id.localeCompare(b.id));

  const minimumPreparationWeeks = preparationWeeks(distance, athleteLevel);
  const alternatives = goalClass === "No recomendable actualmente" ? ["Cambiar a completar con salud", "Elegir una fecha posterior"] : [];
  const inputSnapshot = {
    profile: {
      age: profile.age,
      recent5kMin: profile.recent5kMin,
      recent5kDate: profile.recent5kDate,
      recent10kMin: profile.recent10kMin,
      recent10kDate: profile.recent10kDate,
      recentHalfMin: profile.recentHalfMin,
      recentHalfDate: profile.recentHalfDate,
      currentWeeklyRuns: weeklyRuns,
      currentWeeklyMinutes: weeklyMinutes,
      longestRunMinutes: longestMinutes,
      weeksSinceTraining: breakWeeks,
      loadAssessment: { weeklyRuns, weeklyMinutes, longestMinutes, recentPain },
      trainingSchedule: schedule,
      recoveryProfile: recovery,
      precautionScreening: profile.precautionScreening,
    },
    goal: { ...goal },
    strengthConfig: { division: strengthConfig.division, exercises: [...(strengthConfig.exercises || [])] },
    strengthPlan: { version: STRENGTH_ALGORITHM_VERSION, ruleset: STRENGTH_RULESET_VERSION, division: strengthPlan.division, assignments: strengthPlan.assignments, equipment: profile.gymAccess === false ? profile.strengthEquipment || [] : ["Gimnasio completo"] },
  };
  const notes = [
    `Algoritmo ${ALGORITHM_VERSION} · reglas ${RULESET_VERSION}. Nivel ${athleteLevel} (${levelName}); la carga manual guía la base y las actividades complementan molestias y tirada larga.`,
    `Aumento semanal máximo: ${Math.round(maxProgress * 100)}%; descarga del 20% en la cuarta semana de construcción. Taper: ${taperWeeks} semana(s).`,
    "Calentamiento y enfriamiento de carrera: 10 min cada uno. Ninguna carrera se programa con menos de 30 min disponibles.",
    "Las sesiones de cinta y exterior conservan el entorno elegido para cada día. RPE prevalece sobre ritmo y velocidad.",
    `Fuerza ${STRENGTH_ALGORITHM_VERSION} según la plantilla ${strengthPlan.division}; ejercicios estables, dosis moderada y ajustes registrados sin alterar la carrera.`,
    "Las sesiones omitidas no se recuperan acumulando carga.",
  ];
  if (poorRecovery || precaution) notes.push("Hay señales de precaución; mantén carga conservadora y solicita consejo profesional cuando corresponda.");
  return {
    version,
    algorithmVersion: ALGORITHM_VERSION,
    rulesetVersion: RULESET_VERSION,
    rulesReviewed: RULES_REVIEWED,
    strengthAlgorithmVersion: STRENGTH_ALGORITHM_VERSION,
    strengthRulesetVersion: STRENGTH_RULESET_VERSION,
    generatedAt: now.toISOString(),
    inputSnapshot,
    athleteLevel,
    eligibility: { ...eligibility, minimumWeeks: minimumPreparationWeeks },
    goalAssessment: { classification: goalClass, reasons: goalReasons, predictedTimeMin, predictedRangeMin, alternatives },
    warnings: [...new Set(warnings)],
    decisions,
    runningMetric: profile.preferredRunningMetric || "time",
    goal,
    weeks: totalWeeks,
    sessions,
    notes,
  };
}

export function assessWeeklyAdaptation({plannedSessions,completedSessions,painDays=0,poorRecoveryDays=0,illnessDays=0,missedTrainingDays=0,redFlag=false}) {
  if(redFlag) return {state:"PAUSE_AND_REFER",ruleId:"ADAPT-PAUSE-001",reason:"Se comunicaron señales de alarma; pausa el entrenamiento y solicita valoración sanitaria."};
  if(plannedSessions<=0) return {state:"MAINTAIN",ruleId:"ADAPT-MAINTAIN-000",reason:"Aún no hay sesiones planificadas en la semana revisada; se mantiene el plan."};
  if(painDays>=1||illnessDays>=1) return {state:"REGRESS",ruleId:"ADAPT-REGRESS-001",reason:"Se comunicó dolor o enfermedad; se elimina la intensidad y se reduce la carga pendiente."};
  if(poorRecoveryDays>=2) return {state:"DELOAD",ruleId:"ADAPT-DELOAD-001",reason:"La recuperación deficiente se repitió; se propone descarga."};
  if(missedTrainingDays>=4) return {state:"REGRESS",ruleId:"ADAPT-REGRESS-002",reason:"Se perdieron cuatro o más días; se retiran sesiones de menor prioridad y se regresa a carga tolerada."};
  const rate=plannedSessions?completedSessions/plannedSessions:0;
  if(rate>=0.8) return {state:"PROGRESS",ruleId:"ADAPT-PROGRESS-001",reason:"Cumplimiento alto sin señales declaradas de dolor, enfermedad o mala recuperación; progresión limitada por nivel."};
  if(rate<0.5) return {state:"REGRESS",ruleId:"ADAPT-REGRESS-003",reason:"Cumplimiento bajo; se reduce la carga y se protege la continuidad."};
  return {state:"MAINTAIN",ruleId:"ADAPT-MAINTAIN-001",reason:"Cumplimiento moderado; se mantiene la carga para consolidar tolerancia."};
}

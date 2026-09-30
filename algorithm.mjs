export const ALGORITHM_VERSION = "RUN-HYBRID-1.0.0";
export const RULESET_VERSION = "2026.1";
export const RULES_REVIEWED = "2026-09-30";
export const ALGORITHM_CONFIG = Object.freeze({
  maximumWeeklyIncreasePctByLevel: { 0:0, 1:0.05, 2:0.05, 3:0.07, 4:0.08 },
  deloadEveryWeeks: 4,
  deloadReductionPct: 0.25,
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

export function generateHybridPlan(profile, goal, version, strengthConfig, catalog, history = [], now = new Date()) {
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

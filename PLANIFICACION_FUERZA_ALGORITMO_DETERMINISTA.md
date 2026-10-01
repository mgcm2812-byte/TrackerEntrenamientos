# Especificación: planificación determinista de fuerza

**Objetivo:** sustituir la rotación actual de ejercicios de fuerza por planes reproducibles de gimnasio con divisiones torso/pierna, push/pull/legs (empuje/tirón/pierna) y full body. La generación debe ser local, sin inferencia ni llamadas a LLM. El calendario de carrera y fuerza debe seguir coordinándose en el generador híbrido existente.

**Alcance:** planes nuevos. No alterar sesiones históricas ni borrar perfiles, configuración guardada o registros. Mantener compatibilidad con historial y API actuales, introduciendo una versión de algoritmo/ruleset para las nuevas prescripciones.

## 1. Conclusiones basadas en evidencia

1. **La división semanal se elige por disponibilidad y adherencia.** Metaanálisis de 14 estudios no encontró diferencias relevantes entre rutina dividida y full body cuando el volumen está igualado. Ninguna división es universalmente superior: elegir la que encaje con los días reales y con la prioridad declarada (en esta aplicación, principalmente correr).
2. **Usar una biblioteca pequeña y estable.** Una revisión sobre variación encontró que una variación sistemática puede ser útil, pero cambiar ejercicios demasiado a menudo o hacerlo al azar puede perjudicar las adaptaciones. Mantener el mismo núcleo de ejercicios en cada repetición del tipo de sesión; cambiar solo por equipo no disponible, dolor/precaución o bloque de entrenamiento explícito.
3. **Dos exposiciones semanales por grupo muscular son un buen objetivo práctico**, pero la frecuencia en sí no tiene un efecto especial si el volumen semanal se iguala. Se usa para distribuir volumen y evitar sesiones desproporcionadas. Full body suele encajar con 2–3 días; torso/pierna requiere preferentemente 4 sesiones para repetir ambos tipos; PPL encaja mejor con 3 o 6 días. No inventar sesiones para rellenar una división.
4. **Comenzar por dosis moderadas y dejar repeticiones en reserva.** El esfuerzo alto puede lograrse con distintas cargas, series y rangos; no hace falta entrenar al fallo ni testar 1RM. Para una aplicación generalista y combinada con carrera, prescribir principalmente 6–15 repeticiones en ejercicios principales y 10–20 en accesorios, con RIR 3 al iniciar y 2–3 como rango habitual. Evitar repeticiones forzadas, fallo deliberado y levantamientos máximos.
5. **Progresión doble, no aumentos arbitrarios.** Subir primero repeticiones dentro del rango. Aumentar el peso solo cuando el usuario complete el extremo alto en todas las series con técnica controlada y RIR objetivo durante dos exposiciones válidas consecutivas. Incremento pequeño y redondeado al siguiente incremento práctico del equipo; nunca generar porcentajes o cargas ficticias si no hay registro de carga.
6. **No prometer prevención de lesiones.** La evidencia general en deportes respalda programas de fuerza para reducir lesiones, pero una revisión específica de programas de ejercicio no halló una reducción global significativa de lesiones en corredores; la señal positiva apareció en intervenciones supervisadas y la certeza/calidad es limitada. Presentarlo como desarrollo de fuerza y tolerancia, no como garantía de evitar lesiones. Dolor persistente o alteración funcional requiere detener/modificar y derivación apropiada, no que el algoritmo diagnostique.
7. **Para corredores, proteger las sesiones clave.** Evitar una sesión dura de pierna el día anterior a intervalos/umbral o tirada larga; dejar idealmente 24–48 horas entre fuerza exigente de piernas y carrera de calidad/tirada larga. Si no se puede, reducir la fuerza de pierna a una microdosis o ubicarla después de la sesión clave, sin desplazar la recuperación. La evidencia de interferencia depende de modalidad, volumen, orden y población; aplicar esto como regla de prudencia, no como ley fisiológica absoluta.

### Implicaciones prácticas

- La prioridad es consistencia, técnica y progresión registrable, no maximizar volumen de culturismo.
- No usar descarga obligatoria semanal tipo 3:1 sin señal. Reducir fuerza por taper de carrera, fatiga, molestias, enfermedad o caída sostenida del rendimiento. Se puede ofrecer una semana ligera planificada cada 4–6 semanas como opción conservadora, reduciendo series, sin hacer afirmaciones de que sea superior para todos.
- Nunca compensar sesiones omitidas añadiendo series/sesiones a los días siguientes.
- El generador no puede asegurar seguridad individual ni sustituir valoración clínica o supervisión técnica.

## 2. Biblioteca del catálogo de administración

Reemplazar el catálogo por patrones claros, comunes y con alternativas realistas de gimnasio. Mantener nombres legibles en español. El catálogo debe describir patrón, grupo principal, equipo, nivel de complejidad y sustituciones equivalentes para que el generador pueda elegir una variante sin cambiar el estímulo de forma aleatoria.

### Pierna y cadera

| Patrón | Ejercicios base | Alternativas equivalentes |
|---|---|---|
| Dominante de rodilla bilateral | Sentadilla goblet; sentadilla con barra (solo si experiencia/equipo); prensa de piernas | Sentadilla en multipower |
| Dominante de rodilla unilateral | Split squat; zancada hacia atrás; step-up bajo | Prensa unilateral |
| Bisagra de cadera | Peso muerto rumano con mancuernas o barra | Pull-through en polea; extensión de cadera en banco, si equipo disponible |
| Extensión de cadera | Hip thrust con barra/máquina | Puente de glúteos |
| Flexión de rodilla | Curl femoral sentado | Curl femoral tumbado |
| Flexión plantar de tobillo | Elevación de gemelos de pie | Gemelo sentado/prensa |
| Dorsiflexión (opcional) | Tibialis raise | Banda elástica para dorsiflexión |

### Torso

| Patrón | Ejercicios base | Alternativas equivalentes |
|---|---|---|
| Empuje horizontal | Press de pecho en máquina; press banca con mancuernas | Press banca con barra |
| Empuje inclinado | Press inclinado con mancuernas o máquina | Flexión inclinada |
| Empuje vertical | Press hombro con mancuernas o máquina | No es obligatorio si el usuario tiene precaución de hombro |
| Tirón vertical | Jalón al pecho; dominada asistida | Dominada libre solo si ya se domina |
| Tirón horizontal | Remo sentado en polea; remo con pecho apoyado/máquina | Remo con mancuerna apoyado |
| Deltoides lateral/posterior (accesorio) | Elevación lateral; pájaro/reverse fly en máquina o polea | Mantener como accesorio opcional |
| Bíceps (opcional) | Curl con mancuerna; curl en polea | Curl con barra EZ |
| Tríceps (opcional) | Extensión en polea | Extensión por encima de cabeza en polea si indolora |

### Tronco

Elegir como máximo 1–2 ejercicios por sesión entre plancha, dead bug, Pallof press y crunch controlado. No programar varios movimientos redundantes para el mismo objetivo. Core complementario; no desplazar los patrones de fuerza principales.

### Cambios respecto al catálogo actual

- Quitar entradas redundantes: dos prensas casi equivalentes; evitar listar “aperturas” como básico obligatorio; retirar “adductor/abductor” del núcleo y ofrecerlos solo como accesorios opcionales.
- Corregir nombres: “Aductor” y “gemelo sentado/de pie” con variantes diferenciadas.
- Añadir bisagra (peso muerto rumano), unilateral de pierna, remo con pecho apoyado, dominada asistida, sentadilla goblet y tibial opcional.
- Las alternativas no son ejercicios adicionales que roten cada día: son fallback por disponibilidad, preferencia o restricción.
- Permitir guardar configuración previa aunque contenga nombres antiguos. Migrar de forma no destructiva: conservar el texto/config histórica y mapear a ejercicios actuales solo al construir un plan nuevo; si no hay sustitución inequívoca, escoger una opción base del patrón y registrar la decisión.

## 3. Selección de división según días de fuerza disponibles

La división es una preferencia, pero el número de sesiones reales y la relación con carrera limitan la estructura. Sin suficientes días para completarla, mostrar recomendación y degradar de forma determinista a full body (sin bloquear entrenamiento).

| Sesiones de fuerza/semana | División recomendada | Reglas |
|---:|---|---|
| 1 | Full body | 4–6 patrones esenciales; volumen bajo |
| 2 | Full body A/B o torso/pierna | Priorizar full body si se combina con carrera y el usuario es principiante; torso/pierna posible si ambas sesiones caben separadas |
| 3 | Full body A/B alterno o PPL | PPL solo si acepta frecuencia 1 por grupo y el objetivo principal es fuerza general; alternar A/B sin cambiar ejercicios semanalmente |
| 4 | Torso/pierna A/B repetidos | Misma plantilla en cada repetición; pequeños cambios A/B solo si el patrón sigue equivalente |
| 5 | Torso/pierna con sesión 5 como full body ligero/accesorios o full body 3 + microdosis | No convertirlo automáticamente en cinco días duros |
| 6 | PPL x2 o full body distribuido | Solo para experiencia y recuperación compatibles; mantener PPL A/B estables |

El usuario puede seleccionar torso/pierna, PPL o full body en admin, pero si el calendario no permite distribuir las sesiones con al menos 1 día sin fuerza y proteger carrera, el servidor debe elegir el ajuste más simple (full body o reducción de frecuencia) y guardar una decisión explicativa. No imponer seis días de fuerza.

## 4. Plantillas fijas por tipo de sesión

Cada plantilla mantiene ejercicios, orden y códigos entre todas las sesiones del mismo tipo durante el bloque. Se admiten A/B solo donde se especifica. El catálogo seleccionado por administración limita ejercicios disponibles, pero cada patrón principal debe quedar cubierto. Si el admin excluye todo un patrón obligatorio, el servidor debe validar la configuración con un mensaje que indique el patrón que falta.

### Full body A (sesión base; plantilla ejemplo)

1. Prensa o sentadilla goblet — dominante de rodilla.
2. Press pecho máquina o mancuernas — empuje horizontal.
3. Remo sentado o pecho apoyado — tirón horizontal.
4. Peso muerto rumano con mancuernas — bisagra (técnica sencilla; si no está disponible, pull-through).
5. Curl femoral sentado — flexión de rodilla.
6. Gemelo de pie o en prensa.
7. Dead bug o Pallof press, opcional.

### Full body B

1. Split squat o zancada atrás asistida — unilateral.
2. Jalón al pecho — tirón vertical.
3. Press inclinado con mancuernas/máquina — empuje inclinado.
4. Hip thrust/puente de glúteos — extensión de cadera.
5. Curl femoral (si no realizado en A, o alternar con gemelo; evitar volumen de pierna excesivo para corredores).
6. Gemelo sentado o tibial, opcional.
7. Plancha o Pallof press, opcional.

Para un día/semana, combinar A y B recortando accesorios; para dos días, alternar A/B manteniendo ambos patrones básicos. No introducir PPL fragmentado en tres días cuando el usuario solo tiene 1–2 días disponibles.

### Torso A/B y Pierna A/B

- **Torso A:** press horizontal, remo horizontal, jalón vertical, press inclinado o elevación lateral, 0–2 accesorios de brazo.
- **Torso B:** press inclinado, remo apoyado, jalón vertical (misma variante que A si posible), empuje vertical opcional, posterior/lateral y 0–2 accesorios de brazo.
- **Pierna A:** dominante rodilla bilateral, bisagra (RDL), curl femoral, gemelo, core opcional.
- **Pierna B:** variante unilateral de rodilla, hip thrust, curl femoral si se tolera, gemelo/tibial, core opcional.
- Si se desean sesiones repetidas, mantener exactamente la plantilla A o B para progresar y registrar.

### PPL A/B

- **Push:** press pecho horizontal; press inclinado o vertical; elevación lateral; tríceps opcional.
- **Pull:** jalón/dominada asistida; remo; deltoides posterior; bíceps opcional.
- **Legs:** dominante de rodilla; bisagra o hip thrust; curl femoral; gemelo; core opcional.
- Tres días: P, PULL, LEGS una vez cada uno (frecuencia baja por músculo; informar que full body puede distribuir mejor el trabajo si la prioridad es salud general/carrera).
- Seis días: PPL A/B repetido solo si el perfil y la recuperación lo permiten; conservar cada plantilla en cada repetición.
- No repetir grupo muscular pesado en días consecutivos. Proteger las carreras clave con las reglas del calendario.

## 5. Dosis inicial, progresión y descarga

### Clasificar experiencia sin inferir capacidades

Usar los datos explícitos existentes de meses/años de fuerza y el historial de sesiones de fuerza completadas. No inferir 1RM a partir de cargas incompletas ni clasificar como avanzado por tiempo solamente. Si faltan datos, clasificar como **inicio/desconocido**.

### Series, repeticiones, intensidad

Prescripciones deterministas (el motor redondea series a enteros y no usa aleatoriedad):

| Estado de fuerza | Series por ejercicio principal | Series accesorios | Rango de repeticiones | Objetivo de esfuerzo inicial |
|---|---:|---:|---:|---|
| Nuevo/desconocido, vuelta tras ≥4 semanas, o molestias recientes | 1–2 | 1 | Principales 8–12; accesorios 10–15 | RIR 3–4 (RPE 6–7) |
| Regular y tolera ≥4 semanas sin síntomas limitantes | 2–3 | 1–2 | Principales 6–12; accesorios 10–15/12–20 | RIR 2–3 (RPE 7–8) |
| Experiencia consistente ≥12 meses y buen registro | 2–4, limitado por carrera y recuperación | 1–3 | Principales 5–10; accesorios 8–15 | RIR 2–3; no fallo |

Topes por sesión para este producto: 5–7 ejercicios; no más de 3 series por movimiento principal en días de pierna si hay carrera de calidad/tirada larga esa semana. No programar más de 8 series duras por gran grupo muscular por semana en el nivel inicio/desconocido. Para el nivel regular comenzar normalmente entre 4–8 series efectivas por grupo a la semana; elevar gradualmente solo con buena adherencia y recuperación. Estos son topes conservadores del producto, no un umbral fisiológico universal.

**Definición de serie efectiva del producto:** serie de trabajo con técnica controlada terminada a RIR ≤4. No contar calentamientos como volumen efectivo.

### Calentamiento y duración

- Calentamiento general opcional 5–8 min de actividad suave y 1–3 series de aproximación progresivas para el primer ejercicio compuesto. Las series de aproximación no cuentan para las series de trabajo.
- No prescribir cargas de calentamiento exactas si no hay peso registrado.
- Descansos orientativos: 2–3 min en compuestos; 1–2 min en accesorios. Dar margen configurable, no simular precisión temporal excesiva.
- La duración mostrada debe calcularse con bloques de trabajo/descanso y redondearse a 5 minutos; debe coincidir con los bloques expuestos en la interfaz. Si el bloque no cabe en el máximo de minutos del día, retirar primero accesorios, luego reducir una serie (nunca reducir por debajo de 1 serie de trabajo por patrón), luego bajar a full body compacta; si aun no cabe, omitir la sesión y mostrar por qué.

### Regla de progresión doble

Por ejercicio y variante, persistir series completadas, repeticiones, carga (si la persona la registró), RIR/RPE, fecha y síntomas.

1. Mantener carga y avanzar repeticiones dentro del rango.
2. Solo subir el incremento mínimo práctico si todas las series alcanzan el máximo del rango, con técnica declarada/control registrada, RIR ≥2 y ese resultado aparece en **dos exposiciones consecutivas** del mismo ejercicio.
3. Incremento sugerido sin calcular números falsos: el siguiente escalón disponible o una propuesta configurable del 2–5% para tren superior / 2–7% para pierna, redondeada a la resolución del equipo. No mostrar peso sugerido cuando la carga base/resolución del equipo no existe.
4. Tras subir peso, reiniciar en la parte baja/media del rango. Si dos exposiciones consecutivas no alcanzan mínimo o RIR≤0 antes de completar, reducir una unidad de peso o mantener y quitar una serie; registrar regla aplicada.
5. Las repeticiones/cargas del objetivo no se incrementan por calendario automáticamente. Si no hay datos de rendimiento, prescribir el rango y RIR, sin inventar progresión completada.

### Señales de descarga o reducción

No depender de un “10% semanal” rígido. Aplicar una reducción determinista:

- Molestia nueva o creciente, dolor que altera movimiento, enfermedad o mala recuperación marcada: cancelar o retirar ejercicio afectado; no prescribir a través del dolor. Síntomas agudos/importantes deben derivarse a atención profesional.
- Dos semanas con fatiga alta/recuperación deficiente, descenso repetido del rendimiento o fuerza completada muy por debajo del plan: siguiente semana reducir series un 30–50% (entero, redondeado hacia abajo); mantener carga solo si RIR y técnica lo permiten; de otro modo bajar carga al último nivel completado con éxito.
- Regreso tras ≥2 semanas sin fuerza: volver a 1–2 series por ejercicio y RIR 4; subir como máximo una variable cada 1–2 semanas si la respuesta es buena.
- Semana de taper de carrera: mantener tren superior fácil; bajar volumen de piernas al menos 40–60% y dejar ≥48 h antes de la prueba. No programar agujetas novedosas, excéntricos agresivos ni ejercicios nuevos.
- Nunca reponer el trabajo recortado o sesiones omitidas en días posteriores.

## 6. Integración con carrera

La planificación de fuerza no debe cambiar la prescripción de carrera ya aprobada salvo coordinación de agenda y registro de decisiones.

1. **Prioridad:** entrenamientos clave de carrera, tirada larga y recuperación; después sesiones de fuerza. Respetar `trainingPriority` y días con carrera ya seleccionados.
2. **Ubicación:** no asignar pierna pesada en las 24 h anteriores a carrera de calidad ni 48 h antes de tirada larga; si solo hay días contiguos, reducir a sesión de pierna de 1 serie por patrón a RIR≥4, mover tras carrera clave si el calendario permite o suprimir pierna esa semana.
3. Si se hacen carrera y fuerza el mismo día, preferir separarlas ≥3 h si es posible. Si no, poner primero la prioridad declarada. Si prioridad carrera, carrera primero; si prioridad fuerza, fuerza primero excepto en día de sesión de calidad/tirada larga, donde carrera tiene prioridad.
4. La carrera cuenta como carga externa; no convertir kilómetros en series ni inferir fatiga matemática no disponible. Usar señales manuales del perfil y registros reales.
5. La frecuencia y volumen de fuerza deben bajar durante taper de carrera y semana de competición. Retener práctica de torso y, si ya está habituado, estímulo mínimo de piernas sin fatiga tardía.
6. Cuando dos sesiones de fuerza del mismo tipo ocurren en una semana, conservar los mismos ejercicios de plantilla y reflejar progresión por historial, no alternar candidatos por índice de día/semana.

## 7. Datos y reproducción

Versionar por separado, por ejemplo `STRENGTH-1.0.0` y ruleset `2026.1`. Guardar por cada plan:

- snapshot de perfil relevante: experiencia de fuerza, disponibilidad, días de carrera y fuerza, acceso/equipo, prioridad, flags de dolor/recuperación pertinentes;
- catálogo/versiones y división elegida;
- plantillas y variante concreta de cada patrón;
- series, repeticiones, rango RIR, descanso, duración y restricciones aplicadas;
- decisiones: nivel de inicio, fallback de catálogo, modificación de calendario, recorte por minutos, deload/taper/safety y motivo;
- clave/ID estable de sesión y ejercicio para enlazar registros futuros.

Misma versión, mismo snapshot, mismo historial y mismo reloj de referencia => mismo plan. La fecha actual debe inyectarse en el generador para que el comportamiento se pueda reproducir en tests/manual audit.

## 8. Interfaz y administración

- Mostrar divisiones “Torso/Pierna”, “Empuje/Tirón/Pierna” y “Cuerpo completo”. Normalizar nombres antiguos `FullBody` y `Tirón/Empuje/Pierna` sin romper datos.
- El panel de administración deja configurar catálogo/equipo y ejercicios disponibles, pero no necesita obligar a seleccionar todos los ejercicios de un grupo. Validar cobertura de patrones esenciales para la división seleccionada y explicar los faltantes.
- Ofrecer un switch para acceso a gimnasio/equipo en perfil o emplear `gymAccess` existente. Si no hay gimnasio, limitar a ejercicios con peso corporal/bandas/mancuernas declaradas; no asignar prensa/poleas.
- En cada sesión mostrar ejercicio, patrón, series × rango de reps, RIR/RPE, descanso y nota breve de técnica. Separar series de aproximación y de trabajo.
- Añadir formulario de registro por ejercicio: carga opcional, repeticiones por serie, RIR/RPE y dolor/síntoma. Permitir omitir la carga: el plan sigue generándose y no muestra una progresión inventada.
- Mensajes de coordinación con carrera concretos: “reducimos pierna para proteger la tirada larga del día siguiente”. Evitar promesas como “previene lesiones” o diagnósticos.
- El usuario puede cerrar, sustituir por alternativa equivalente o marcar ejercicio no disponible. Cada sustitución se mantiene para siguientes sesiones del mismo tipo del bloque y queda registrada.

## 9. Límites de salud y seguridad

- El sistema ofrece orientación general a adultos aparentemente sanos; no es diagnóstico, rehabilitación ni prescripción clínica.
- No generar esfuerzo máximo, fallo forzado ni prueba de 1RM. Detener/modificar si se informa dolor nuevo que empeora o altera la técnica/marcha.
- Ante embarazo, enfermedad cardiovascular/metabólica no controlada, cirugía reciente, dolor persistente o limitación importante, solicitar valoración profesional antes de fuerza intensa; no intentar inferir aptitud desde un checkbox.
- Nunca etiquetar el plan como “seguro” o “a prueba de lesiones”. Registrar qué regla conservadora se aplicó y mantener al usuario en control.

## 10. Ejemplo completamente determinista

Usuario adulto principiante, 2 sesiones de fuerza/semana, corre 3 días, tiene acceso a gimnasio y no reporta dolor. Elige full body. El sistema genera siempre Full Body A lunes y B jueves si esos son los días seleccionados; nunca rota a otro ejercicio de manera aleatoria.

**Semana 1 (adaptación):** cada patrón principal 1–2 series; principales 8–12, accesorios 10–15; objetivo RIR 4. El usuario completa press máquina 2×10, 2×9 a RIR 3: próxima vez conserva carga y busca una repetición más en alguna serie.

**Siguiente exposición del mismo A:** 2×11 y 2×10, RIR 2–3. Mantiene carga.

**Dos exposiciones sucesivas completando 2×12 con RIR≥2:** el algoritmo sugiere el siguiente escalón pequeño del equipo (no escribe un valor en kg si no conoce la carga y resolución de máquina); repeticiones vuelven al inicio del rango.

**Molestia de rodilla que altera la sentadilla:** se retira el patrón ese día y se registra. No se sustituye por más volumen ni se diagnostica; para plan futuro se ofrece una alternativa indolora de menor complejidad solo si el usuario confirma que puede realizarla y se aconseja valoración si persiste.

**Semana de carrera objetivo:** baja el volumen de pierna 40–60%, no introduce variantes nuevas y no ubica fuerza dura en las 48 h antes de competir.

## 11. Criterios de aceptación para implementación

1. Los planes nuevos ofrecen torso/pierna, PPL y full body; elegir división no modifica los resultados de fuerza si división y volumen semanal son equivalentes de forma irreal: algoritmo respeta las sesiones realmente disponibles.
2. Repeticiones del mismo tipo de sesión utilizan idénticos ejercicios/orden durante el bloque, salvo fallback explícito registrado por equipo, preferencia, dolor o falta de disponibilidad.
3. Catálogo reemplaza las entradas duplicadas/ambiguas y cubre rodilla bilateral, rodilla unilateral, bisagra, extensión de cadera, flexión de rodilla, empuje horizontal/vertical opcional, tirón horizontal/vertical y accesorios/core opcionales.
4. La misma entrada/versionado/historial produce un resultado reproducible; no hay random, rotación por semana ni cargas sugeridas inexistentes.
5. Progresión solo avanza con registro real y doble progresión; ausencia de registro no cuenta como sesión completada.
6. Fatiga, molestia, interrupción y taper reducen o eliminan volumen de forma explicable; sesiones omitidas nunca se acumulan.
7. La agenda respeta carreras de calidad/tiradas largas y no deja grupos de piernas pesados el día previo a esfuerzo clave si hay alternativa.
8. No se programan fallo deliberado, 1RM ni aumentos porcentuales de carga no sustentados en peso inicial registrado.
9. Ningún plan promete prevenir lesiones ni usa el algoritmo como diagnóstico; el usuario puede parar o sustituir y el servidor conserva esa decisión.
10. Las prescripciones de series/repeticiones/descanso suman una duración mostrada coherente; al recortar por tiempo se quitan primero accesorios y luego series, sin ocultar la reducción.
11. Planes y registros históricos siguen accesibles tras versionado y migración del catálogo.

## 12. Fuentes

La evidencia no determina una única plantilla de ejercicios ni un número óptimo universal para corredores. Las dosis concretas anteriores son decisiones conservadoras de producto derivadas de los principios de esfuerzo, exposición gradual, volumen moderado, repetibilidad y gestión concurrente de carrera; no deben describirse como fórmulas clínicas validadas.

1. ACSM. *Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews* (Position Stand, 2026). Página oficial del ACSM: [Position Stands](https://acsm.org/education-resources/pronouncements-scientific-communications/position-stands/) (enlace al artículo en MSSE desde esa página).
2. Currier BS et al. *Resistance training prescription for muscle strength and hypertrophy in healthy adults: a systematic review and Bayesian network meta-analysis.* Br J Sports Med. 2023;57:1211–1220. [PubMed](https://pubmed.ncbi.nlm.nih.gov/37414459/). Incluyó 178 estudios para fuerza y 119 para hipertrofia; todas las combinaciones de entrenamiento superaron control, más carga favoreció fuerza y multiseries favorecieron hipertrofia.
3. Ramos-Campo DJ et al. *Efficacy of Split Versus Full-Body Resistance Training on Strength and Muscle Growth: A Systematic Review With Meta-Analysis.* J Strength Cond Res. 2024;38(7):1330–1340. [PubMed](https://pubmed.ncbi.nlm.nih.gov/38595233/). Diferencias no significativas entre split y full-body con volumen equiparado.
4. Kassiano W et al. *Does Varying Resistance Exercises Promote Superior Muscle Hypertrophy and Strength Gains? A Systematic Review.* J Strength Cond Res. 2022;36(6):1753–1762. [PubMed](https://pubmed.ncbi.nlm.nih.gov/35438660/). Apoya variación sistemática limitada; advierte que cambios excesivos/aleatorios pueden comprometer ganancias.
5. Lauersen JB et al. *Strength training as superior, dose-dependent and safe prevention of acute and overuse sports injuries: a systematic review, qualitative analysis and meta-analysis.* Br J Sports Med. 2018;52:1557–1563. [DOI](https://doi.org/10.1136/bjsports-2018-099078). Evidencia general de deporte, no prueba específica para todo corredor.
6. *Do Exercise-Based Prevention Programs Reduce Injury in Endurance Runners? A Systematic Review and Meta-Analysis.* Sports Med. 2024. [Artículo](https://pmc.ncbi.nlm.nih.gov/articles/PMC11127851/). Nueve artículos/1904 participantes; resultado global sin diferencia significativa de riesgo/tasa, análisis post hoc positivo para intervenciones supervisadas; baja calidad en la mayoría de estudios.
7. Ceyssens L et al. *Biomechanical Risk Factors Associated with Running-Related Injuries: A Systematic Review.* Sports Med. 2019;49(7):1095–1115. [PubMed](https://pubmed.ncbi.nlm.nih.gov/31028658/). La evidencia prospectiva fue escasa e inconsistente; no justifica convertir factores aislados en prevención garantizada.
8. ACSM. *Progression Models in Resistance Training for Healthy Adults.* Med Sci Sports Exerc. 2009;41(3):687–708. [DOI](https://doi.org/10.1249/MSS.0b013e3181915670). Recomendaciones históricas de progresión y entrenamiento saludable; leer junto a la actualización ACSM 2026.


# Especificación para planificar entrenamientos de carrera con reglas deterministas

Documento de producto e implementación para Codex. El planificador debe usar exclusivamente datos explícitos del usuario, historial registrado y reglas versionadas. No debe llamar a LLM, servicios externos ni usar números aleatorios. Alcance: 5 km, 10 km y media maratón (21,0975 km); no generar planes de maratón.

> **Límite de uso:** esta especificación organiza entrenamiento general para adultos aparentemente sanos; no diagnostica, rehabilita lesiones ni sustituye supervisión profesional. La aplicación no debe presentar una fecha como garantía de lograr una marca. El objetivo prioritario ante señales de alarma es parar y recomendar valoración sanitaria.

## 1. Qué respalda la evidencia y qué es una decisión de producto

La investigación en corredores recreativos no determina una única plantilla óptima ni un mínimo universal de semanas para preparar cada distancia. La evidencia es heterogénea, hay estudios pequeños y gran parte de los planes concretos son práctica de entrenamiento, no protocolos comparados en ensayos para cada combinación de sexo, edad, nivel y distancia. Por eso:

1. Separar **hallazgos respaldados** de **valores iniciales conservadores del producto**. Marcar los segundos como configurables y versionados; no afirmar que un porcentaje o calendario sea garantía de prevención de lesiones.
2. Personalizar primero con carga reciente tolerada, disponibilidad y continuidad; usar edad/experiencia como contexto, no como sustituto de la carga demostrada.
3. Evitar progresiones súbitas, especialmente saltos de volumen/intensidad y aumentos grandes de la tirada larga. La evidencia sobre una regla fija del 10% es insuficiente: no codificarla como ley biológica. Un ensayo aleatorizado no encontró diferencia de lesiones al progresar volumen frente a intensidad; la literatura observacional encuentra señales de riesgo con cambios grandes, pero no un umbral «seguro» universal. [revisión de carga y lesiones](https://pubmed.ncbi.nlm.nih.gov/30534459/), [ensayo Run Clever](https://pubmed.ncbi.nlm.nih.gov/29895234/).
4. La mayoría del tiempo debería ser fácil para la población recreativa. Un ensayo de ocho semanas en corredores recreativos observó mejoras con dos distribuciones diferentes (aprox. 77/3/20 y 40/50/10 por zonas), por lo que no permite proclamar un reparto ganador universal. Aplicar como valor inicial que **80–90% de los minutos de carrera sean fáciles (RPE 2–4/10)** y limitar la calidad; el control principal es RPE/talk test, no un porcentaje mágico. [ensayo en corredores recreativos](https://pubmed.ncbi.nlm.nih.gov/33344993/).
5. Una descarga antes de competición tiene respaldo en metaanálisis de atletas de resistencia: en general reducir progresivamente volumen alrededor de 41–60%, mantener algo de intensidad y, si la carga habitual lo permite, frecuencia, durante hasta 21 días. La respuesta individual y el nivel de evidencia imponen no aplicar el mismo porcentaje sin mirar la línea base. [metaanálisis de resistencia 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10171681/), [metaanálisis de taper 2007](https://pubmed.ncbi.nlm.nih.gov/17762369/).
6. Volumen semanal y tirada larga se asocian al rendimiento en corredores recreativos de media maratón, pero el estudio es observacional, no prescribe que todo el mundo corra >32 km/semana ni que haga 21 km en entrenamiento. No exigir una tirada de distancia de carrera como requisito. [cohorte de preparación de media maratón](https://pubmed.ncbi.nlm.nih.gov/32421886/).
7. Cinta y carrera exterior se solapan, pero no son idénticas en biomecánica, percepción ni medidas de rendimiento. La evidencia no respalda convertir siempre ritmos de cinta a exterior con un factor universal. El 1% de pendiente procede de estudios energéticos concretos y no debe imponerse a todas las personas, velocidades o máquinas. La revisión sistemática biomecánica encontró diferencias entre condiciones. [revisión fisiológica/perceptiva/rendimiento](https://pubmed.ncbi.nlm.nih.gov/30847825/), [revisión biomecánica](https://pmc.ncbi.nlm.nih.gov/articles/PMC7069922/), [estudio original sobre pendiente 1%](https://pubmed.ncbi.nlm.nih.gov/8887211/).
8. No hay evidencia que imponga exactamente 10 minutos de calentamiento y 10 de enfriamiento en toda sesión. Para hacer los planes comprensibles y evitar duraciones aleatorias, la aplicación puede adoptar **10 min fáciles de calentamiento y 10 min de enfriamiento como bloques estándar fijos** en cada sesión de carrera no competitiva. Es una decisión de producto sensata y simple, no una dosis universal demostrada. En competición o sesión de intervalos, el calentamiento puede requerir activación específica adicional; se debe indicar separadamente y con duración fija por plantilla. El enfriamiento es opcional desde el punto de vista de beneficio de recuperación; caminar/trotar suave facilita una transición cómoda, pero no prometer que evite agujetas o lesiones. [revisión de enfriamiento](https://pmc.ncbi.nlm.nih.gov/articles/PMC5999142/).

## 2. Requisitos de entrada y prioridad de datos

No crear un plan hasta validar entradas esenciales. Guardar una instantánea de los datos usados y los identificadores de reglas para poder reproducir el resultado.

### Datos mínimos

- Distancia objetivo: `5K | 10K | HALF_MARATHON`.
- Fecha del evento y fecha actual local; calcular semanas completas disponibles sin redondear a favor del usuario.
- Objetivo: `finish` o marca objetivo; permitir que el plan recomiende terminar sin objetivo temporal.
- Edad y, si menor de 18 años, no usar estas plantillas adultas: mostrar que el plan requiere supervisión adecuada.
- Historial de carrera de las últimas 6–8 semanas: sesiones/semana, minutos y/o distancia por semana, tirada más larga, superficie, intensidad percibida, semanas de interrupción y actividad omitida. Dar prioridad a sesiones completadas, no planificadas.
- Experiencia declarada (meses/años), continuidad reciente, ritmo/tiempo de una carrera o prueba reciente con distancia y fecha (opcional), RPE habitual (opcional).
- Días disponibles por semana, días preferidos, duración máxima por día; disponibilidad para fuerza separada.
- Entorno deseado **por sesión** (`outdoor | treadmill`), no una sola etiqueta global. Registrar pendiente prevista, unidades, si la cinta está calibrada y límite de velocidad cuando proceda.
- Dolor actual, dolor que altera la marcha, lesión reciente/recurrente, enfermedad/fiebre y cribado de señales de alarma. Datos de sueño/fatiga/estrés pueden modular conservadoramente, nunca inferir un diagnóstico.
- Condiciones que cambian la prescripción: embarazo/posparto, afección cardiovascular, medicación relevante u otra restricción declarada: pedir indicación profesional antes de prescribir intensidad.

Si faltan historial o marca reciente, generar por RPE/talk test y duración, nunca inventar un ritmo. Una marca vieja o de una distancia no equivalente debe etiquetarse como estimación débil. Preferencia de unidades no cambia la carga real.

### Jerarquía determinista

1. Seguridad y restricciones actuales.
2. Capacidad tolerada en historial reciente y continuidad.
3. Días/minutos realmente disponibles.
4. Distancia y semanas hasta la meta.
5. Marca reciente válida y objetivo temporal.
6. Experiencia declarada y preferencias.

No inferir capacidad por peso, género, ingresos, ubicación ni dispositivos. No usar una equivalencia de marca como diagnóstico de preparación.

## 3. Nivel de preparación basado en datos

Clasificar de forma explicable, no con una puntuación opaca. Las siguientes bandas son **guardarraíles iniciales del producto**, no cortes clínicos:

- **Reinicio / base insuficiente:** sin 20–30 min de trote continuo tolerado, menos de 2 carreras por semana en promedio, pausa ≥4 semanas, o dolor reciente relevante. Primero proponer bloque de retorno/base; no plan temporal competitivo.
- **Principiante consistente:** típicamente 2–3 días/semana, historial estable durante 6–8 semanas y tirada fácil tolerada de alrededor de 30–45 min.
- **Intermedio:** típicamente 3–4 días/semana, continuidad de varios meses, capacidad de 45–75 min fácil y cierta experiencia con cambios de ritmo.
- **Avanzado recreativo:** 4+ días/semana, base sostenida, historial tolerado suficiente y experiencia de sesiones de calidad. Este nivel nunca autoriza duplicar sesiones duras.

La condición real manda sobre la etiqueta: si se declara «avanzado» pero los últimos 28 días muestran dos salidas, reducir a reinicio. Al volver de una pausa ≥2 semanas, no retomar la carga previa íntegra; ≥4 semanas, reconstruir base; una lesión exige seguimiento y, si hay síntomas, criterio profesional.

## 4. Semanas mínimas, elegibilidad y banner

No existe umbral científico único de semanas mínimas por distancia. Implementar los mínimos como política visible y versionada que protege el tiempo para base, especificidad y descarga; calibrarlos con validación clínica/de producto posterior. Valores iniciales:

| Objetivo | Base suficiente (principiante consistente o superior) | Reinicio/base insuficiente |
|---|---:|---:|
| 5 km | 8 semanas | 12 semanas y bloque inicial sin objetivo de marca |
| 10 km | 10 semanas | 16 semanas y bloque inicial sin objetivo de marca |
| Media maratón | 12 semanas | 20 semanas; exigir base de carrera antes del bloque específico |

Interpretación: se requiere ese número de **semanas completas** entre hoy y carrera. Son mínimos operativos conservadores, no promesa de que cualquier corredor estará listo. Si no cumple, bloquear la selección de esa fecha/objetivo de marca y mostrar banner concreto, p. ej. «Para preparar una media maratón recomendamos al menos 12 semanas con tu base actual. Elige una fecha a partir del [fecha calculada] o selecciona un objetivo de completar sin marca y una fase de base, si está disponible». Para reinicio, usar su mínimo más largo. No esconder la alternativa de un objetivo posterior. Si faltan datos para clasificar, aplicar el mínimo de reinicio o pedir que complete el historial.

Aunque cumpla el mínimo, clasificar objetivo temporal como `NO_VALIDADO` cuando el ritmo objetivo no esté sustentado por marca reciente y entrenamiento; no asegurar su viabilidad. Para un objetivo ambicioso sin base, permitir cambiar a «terminar con seguridad» o fecha posterior. Los tiempos predictivos (p. ej. Riegel) solo son orientación, indicar rango amplio y calidad/fecha de entrada, jamás usar para decidir que un plan está aprobado sin comprobaciones de volumen y continuidad.

## 5. Estructura del plan

Fases dependientes del tiempo disponible; si sobran semanas, prolongar base, no añadir intervalos por rellenar. Orden recomendado:

1. **Base/adaptación:** regularidad; carrera fácil o correr-caminar; técnica natural; progresión pequeña de minutos; sin sesiones de VO₂max para quien empieza.
2. **Construcción:** consolidar frecuencia/duración. Añadir primero minutos fáciles o una salida adicional corta; después, como máximo una sesión de calidad semanal al inicio.
3. **Específica:** una sesión de calidad semanal para la mayoría recreativa; corredores consolidados pueden llegar a dos estímulos exigentes solo si el historial los demuestra tolerados, separados por al menos 48 h y sin colocar tirada larga exigente pegada. Una tirada larga mayormente fácil es el segundo estímulo de carga, aunque no sea rápida.
4. **Descarga/absorción:** tras tres semanas de construcción, reducir en la cuarta un 20% los minutos de carrera de la semana anterior, redondeando hacia abajo a múltiplos de cinco minutos. Si dolor, fatiga, enfermedad o semanas omitidas lo justifican, reducir antes; no esperar a la semana programada. No subir volumen e intensidad simultáneamente.
5. **Afinamiento precompetición (taper):** 7 días para 5/10 km y 14 días para media. La semana final tiene como objetivo el 60% de los minutos de entrenamiento habituales (reducción del 40%); para media, la semana -2 tiene objetivo 80%. Excluir la competición del cálculo de minutos de entrenamiento. Mantener frecuencia si los bloques mínimos caben y conservar solo toques breves de intensidad familiar; acortar tirada larga y fuerza de piernas. No realizar una semana de descarga completa en cama.
6. **Recuperación post carrera:** semana posterior con descanso o actividad muy fácil acorde a distancia, experiencia y síntomas. No arrancar automáticamente nuevo bloque intenso.

Las semanas de carga reducida dentro del ciclo y el taper final son cosas distintas. No encajar una gran tirada larga o prueba máxima en la semana previa.

## 6. Distribución semanal y tipos de sesión

Plantilla base, siempre recolocada a los días reales del usuario:

- 2 días de carrera: una carrera fácil, una sesión progresiva/sesión específica muy moderada según experiencia; no dos sesiones duras.
- 3 días: fácil + calidad controlada (solo con base) + tirada fácil/continua algo más larga. Principiante: todas fáciles al comienzo.
- 4 días: dos fáciles + calidad + larga fácil. Opcionalmente bloques cortos a ritmo objetivo dentro de una fácil, contabilizados como calidad.
- 5+ días: incrementar primero carreras fáciles cortas; preservar al menos 1 día sin carrera o carga muy baja. No es requisito entrenar seis o siete días.

Dejar al menos un día fácil/descanso entre sesiones de carga alta y, por defecto, ≥48 horas entre dos sesiones de calidad. No recuperar sesiones perdidas apilándolas, duplicando duración o cambiando un día fácil por calidad. La salida larga se define por minutos apropiados a la base y distancia; no por alcanzar obligatoriamente la distancia de carrera.

### Zonas sin inventar datos

Usar escala RPE 0–10 y talk test en todo plan:

- Fácil/recuperación: RPE 2–4; puede hablar en frases completas. Si no puede, bajar ritmo o caminar.
- Moderado/tempo controlado: RPE 5–6; habla en frases breves; bloques sostenibles y no máximos.
- Umbral aproximado: RPE 6–7; esfuerzo «duro controlado», pocas palabras, nunca sprint. Solo para corredor con base/experiencia y en dosis limitada.
- Intervalo corto: RPE 7–8, técnica estable, recuperación suficiente; no prescribir RPE 9–10 de manera rutinaria.
- Progresivos: 15–20 s ágiles y relajados, recuperar caminando/trotando hasta normalizar respiración. No son sprints ni trabajo máximo.

Si hay umbrales medidos válidos por prueba reciente, pueden informar zonas, pero mantener RPE como verificación. No calcular FC máxima mediante 220−edad como verdad individual. Si el reloj y RPE discrepan, el usuario debe poder seguir RPE, particularmente con calor, cuestas, estrés o cinta.

### Ritmos y redondeo

- Solo mostrar ritmos numéricos de entrenamiento si existe marca/test válido y reciente (preferencia: ≤8 semanas; degradar confianza hasta 12; después pedir nueva prueba o usar RPE). La fecha de referencia debe quedar visible.
- Derivar ritmo objetivo de sesiones de prueba/carrera, no del tiempo objetivo arbitrario que se desea conseguir. Se puede convertir una carrera reciente mediante ecuación de Riegel `T2 = T1 × (D2/D1)^k`, pero `k` depende del atleta y la predicción se degrada en distancias distintas; usarlo como orientación y limitar el error mostrado. No extrapolar una marca corta a media como ritmo prescriptivo exacto.
- Las zonas pueden expresarse como intervalos amplios alrededor de ritmo umbral/ritmo de carrera reciente, con RPE como autoridad. Documentar fórmula, rango y procedencia; nunca sumar restas arbitrarias «por nivel» sin evidencia.
- Redondeo: ritmos al segundo por km (o pasos de 5 s/km en interfaz resumida), velocidad de cinta a 0,1 km/h; intervalos de duración a minutos enteros; repeticiones por distancia en 100 m, 200 m, 400 m u 1 km. Distancias de una sesión a 0,1 km. No mostrar 13,8 minutos como consecuencia de multiplicar porcentajes; mostrar, por ejemplo, `4 × 5 min` o `20 min`.
- En sesiones fraccionadas, el tiempo de trabajo, recuperación, calentamiento y enfriamiento debe sumar exactamente a `durationMin`. Usar una función de redondeo centralizada y comprobar invariantes; no reajustar silenciosamente ritmos o duración para cuadrar límites.

## 7. Progresión cuantizada, descarga y respuesta al usuario

El generador es determinista: mismo snapshot + misma versión de algoritmo = mismo plan y mismo orden. No usar azar, hora de generación como semilla, rotación cosmética ni seleccionar entre sesiones equivalentes al azar.

1. Tomar las últimas 4–6 semanas completas toleradas, no la mejor semana ni una semana de lesión. Estimar carga base robusta con mediana de minutos semanales y número habitual de salidas; excluir pausas/enfermedad identificadas.
2. Construir calendario sobre **minutos**, con distancia secundaria cuando su precisión es razonable. Aumentar una sola variable a la vez (frecuencia o minutos fáciles o intensidad). No aplicar un porcentaje universal (ni 7%, ni 10%) a cada sesión.
3. Como guardarraíl interno, no permitir saltos abruptos respecto de la carga manual reciente. Usar estos topes versionados: reinicio (niveles actuales 0–1), 0%; principiante (nivel 2), 5%; intermedio (nivel 3), 7%; avanzado (nivel 4), 8%. No se muestran como umbrales «seguros»: son reglas conservadoras de producto, no prueba de prevención. Redondear las semanas hacia abajo a múltiplos de cinco minutos. Si las nuevas salidas deben añadirse, dividir minutos en pequeñas sesiones y comprobar la carga por sesión; no aumentar a la vez volumen e intensidad.
4. Aumentar la tirada larga solo desde la más larga tolerada indicada por el perfil o el historial disponible, respetando el tope semanal de progresión y el límite de sesión. Limitarla al 35% del objetivo semanal de minutos; si no cabe, omitirla o mantenerla, nunca escalarla más allá de la regla.
5. Intensidad: primer bloque sin intervalos; luego un estímulo semanal como máximo para la mayoría; subir primero minutos totales del bloque de trabajo o repeticiones, nunca ambos a la vez. Conservar recuperación suficiente y una salida fácil posterior.
6. Ante sesión omitida, no reponer. Ante RPE inusualmente alto, mal sueño/fatiga o dolor leve que persiste, mantener o reducir siguiente carga; ante dolor que empeora o altera zancada, cancelar carrera y recomendar valoración. Mostrar qué entrada disparó cada ajuste.
7. Si la duración máxima disponible no permite calentamiento + trabajo + enfriamiento, elegir sesión fácil más corta (mínimo práctico fijado en plantilla) o descanso; no comprimir a 3 minutos los bloques fijos ni cortar una repetición sin explicarlo.

Al adaptar tras una semana, salidas válidas deterministas: `PROGRESS_SMALL`, `MAINTAIN`, `DELOAD`, `PAUSE_AND_REFER`. Registrar regla, valores anteriores/nuevos, motivo y confirmación; nunca reescribir silenciosamente sesiones completadas.

## 8. Diferencias entre 5 km, 10 km y media maratón

Estas son prioridades de estímulo, no tres recetas rígidas. El número total de sesiones duras depende del nivel; empezar siempre por la dosis más baja.

| Meta | Énfasis específico | Ejemplos de sesión de calidad una vez construida la base | Tirada larga orientativa |
|---|---|---|---|
| 5 km | Economía, cambios de ritmo, capacidad aeróbica; sesiones algo más breves y alegres | 6 × 2 min RPE 7 con 2 min fácil; progresar eventualmente a 5 × 3 min. Alternativa: 6 × 20 s progresivos al final de fácil | Fácil; duración tolerada del atleta, sin forzar distancia específica |
| 10 km | Base aeróbica más bloques de umbral/ritmo controlado y algunos intervalos | 3 × 8 min RPE 6–7 con 2 min fácil; o 5 × 3 min RPE 7 con 2 min fácil | Fácil, crecimiento gradual; no convertir cada larga en tempo |
| Media maratón | Volumen fácil sostenible, resistencia específica, nutrición/hidratación individual si la duración lo hace pertinente | 2 × 15 min RPE 5–6 o 3 × 10 min RPE 6, 3 min fácil; más adelante tramos moderados dentro de larga solo en corredor consolidado | Por minutos, progresiva según base; no requiere correr 21,1 km en entrenamiento ni superar 21 km |

En cada ejemplo se conserva calentamiento y enfriamiento fuera del bloque principal. Repeticiones son opciones de plantilla, no aumentan semana a semana automáticamente. Mantener fácil toda recuperación. La carrera objetivo se prescribe por esfuerzo además del ritmo; clima, desnivel y superficie pueden hacer inadecuado el ritmo calculado.

### Ejemplo de plan con carga insuficiente

Usuario con 2 carreras/semana, 70 min/semana estables en cuatro semanas, tirada más larga 40 min, sin marca reciente, desea 10 km en 6 semanas. Aunque su experiencia declarada sea de años, el calendario no satisface el mínimo de 10 semanas. **No mostrar plan de marca como seleccionable.** Banner: «Con tu continuidad actual recomendamos al menos 10 semanas para preparar 10 km; la fecha elegida queda a 4 semanas del mínimo. Elige una fecha a partir del [fecha] o cambia a un bloque de base sin objetivo temporal». Si una opción de mantenimiento/base de 6 semanas está permitida, mostrar explícitamente que no es un plan de competición.

### Ejemplo de progresión cuantizada para media maratón

Perfil ficticio: carga semanal manual declarada de 160 min, 3 salidas/semana, tirada larga 60 min, una sesión exterior marcada como larga, 14 semanas disponibles y carrera reciente 5 km en 25:00. Hay tres días de carrera distintos. Estos valores ilustran la lógica de redondeo y las reglas de progresión; las duraciones concretas dependen de los días y límites elegidos.

| Semana | Minutos carrera previstos | Distribución ilustrativa | Nota |
|---:|---:|---|---|
| 1 | 160 | 55 larga fácil + 55 fácil + 50 fácil | Mantener cerca de base; aún sin calidad |
| 2 | 165 | 55 larga fácil + 55 fácil + 55 fácil | Incremento pequeño, redondeado a 5 min |
| 3 | 170 | 55 larga fácil + 60 (10 calentamiento + 17 fácil + 2×10 RPE 5–6 con 3 min de recuperación + 10 enfriamiento) + 55 fácil | Una calidad breve; bloques suman 60 min |
| 4 | 135 | 45 larga fácil + 45 fácil + 45 fácil | Descarga del 20% tras tres semanas de construcción |
| 5 | 140 | 45 larga fácil + 50 específica + 45 fácil | Reanudar desde carga tolerada, no saltar a récord |
| 6 | 145 | 50 larga fácil + 50 específica + 45 fácil | Solo una variable sube |
| 7 | 150 | 50 larga fácil + 50 específica + 50 fácil | Validar molestias/RPE antes de avanzar |
| 8 | 120 | 40 larga fácil + 40 fácil + 40 fácil | Descarga del 20% |
| 9 | 125 | 40 larga fácil + 45 específica + 40 fácil | Consolidar |
| 10 | 130 | 45 larga fácil + 45 específica + 40 fácil | Larga aún se guía por minutos |
| 11 | 135 | 45 larga fácil + 45 específica + 45 fácil | Mantener, no aumentar por obligación |
| 12 | 125 | 40 larga fácil + 45 específica + 40 fácil | Semana -2 de taper: alrededor del 80% del volumen habitual |
| 13 | 95 | 30 larga fácil + 35 fácil + 30 fácil | Semana final: alrededor del 60% del volumen habitual |
| 14 | carrera + activación | carrera; una activación corta opcional anterior | No compensar el volumen recortado |

No copiar esta tabla a un usuario real. Su objetivo es ilustrar salida entera y redondeada. El software debe recalcular duraciones para disponibilidad real, respetar exactamente los 10+10 min fijos donde se hayan configurado y no forzar «ritmo de media maratón» si los datos no lo sostienen. El ejemplo suma minutos de carrera; si se incluyen fuerza, sus minutos/carga se contabilizan por separado y no se deben ocultar.

## 9. Calentamiento y enfriamiento

### Plantilla estándar de sesión

- **Calentamiento fijo: 10 min** de trote muy fácil o combinación trote/caminar (RPE 1–3). Para principiante que lo necesite, movilidad dinámica sencilla puede sustituir parte de esos 10 min, no sumarse con duración flotante.
- **Bloque principal:** minutos enteros y repeticiones explícitas. Ejemplo: `4 × 4 min RPE 7, con 2 min de trote fácil entre repeticiones`.
- **Enfriamiento fijo: 10 min** fácil, pudiendo alternar trote y caminar. No afirmar que previene lesiones ni recuperación acelerada.
- Por tanto una sesión con 20 min de trabajo y 3 recuperaciones de 2 min dura `10 + 20 + 6 + 10 = 46 min`. Si se prescribe recuperación final después de la última repetición, indicarlo y sumarlo. No usar sumas implícitas.
- Para carrera fácil de menos de 30 min, no recortar el bloque de 10+10 silenciosamente: permitir una sesión de caminar-correr de duración total adecuada con 10 min de inicio y 10 de final, o explicar que la plantilla estándar requiere 30 min.

### Competición

La carrera es excepción respecto al total de la sesión, no a la duración del bloque: prescribir 10 min de calentamiento fácil y 10 min caminando o muy suave tras la meta como transición opcional. La carrera cronometrada no incluye esos 20 minutos. No añadir progresivos con segundos que no se contabilicen en el plan. La evidencia no confirma un ritual universal de 10 minutos para todo.

## 10. Sesión de cinta frente a exterior

Guardar el entorno en cada sesión y mostrar instrucciones propias. Cada selección de calle produce una sesión exterior; cada selección de cinta produce una sesión de cinta. Si ambas se seleccionan el mismo día, programar ambas solo si el límite diario es al menos 60 min, repartir la carga conjunta dentro de ese límite y permitir como máximo una sesión de calidad ese día. El marcador de tirada larga solo se aplica a la sesión exterior seleccionada para ese rol. Una sesión se puede cambiar de entorno el mismo día sin recalcular el objetivo fisiológico, pero sí cambiando métricas y contexto.

| Variable | Cinta | Exterior |
|---|---|---|
| Control de intensidad | Preferir minutos + RPE; indicar velocidad objetivo solo si existe marca reciente y usuario conoce la cinta | RPE/talk test como principal; rango de ritmo orientativo si terreno plano, clima razonable y marca actual |
| Unidades | Velocidad km/h, pendiente %, duración por bloque. Convertir `km/h = 3600 / segundos_por_km`; mostrar velocidad redondeada a 0,1 km/h | Ritmo min/km redondeado al segundo o intervalo de 5 s; distancia GPS aproximada y tiempo |
| Pendiente | Usar la pendiente seleccionada por el usuario; `0–1%` por comodidad/especificidad es opción, no obligación. No prescribir pendientes altas para «compensar» viento sin saber el objetivo | Registrar ruta/desnivel si se conoce. Cuestas reguladas por RPE, bajar ritmo; no aplicar el ritmo llano en subida/bajada |
| Ajustes externos | Considerar ventilador/calor interior y familiarización. No asumir que velocidad mostrada está calibrada | Calor, humedad, viento, desnivel y superficie alteran esfuerzo; si extremo, ocultar objetivo de ritmo y usar esfuerzo |
| Entrenamiento específico | Fácil: RPE conversación; calidad: velocidad constante y bloques temporizados. No traducir la cinta a una equivalencia exterior exacta | Priorizar especificidad de carrera objetivo; seleccionar ruta segura y comparable, usar vueltas/bloques temporales cuando GPS sea irregular |
| Interfaz | Mostrar `10,5 km/h · 1% · 5 min · RPE 6` | Mostrar `5:43–5:53 min/km · 5 min · RPE 6`, si hay base para ritmo; si no, solo RPE |

No convertir automáticamente todo el exterior a pendiente 1% ni suponer que el 1% «iguala» cada corredor. Evitar una sesión de intervalos tan rápida que la cinta no pueda acelerar con seguridad. Instruir al usuario para ajustar velocidad antes del bloque, usar el clip de seguridad y no bajar de la cinta en movimiento. Para correr en cinta y exterior alternados, que el plan siga minutos/RPE para continuidad comparable; mantener familiaridad con la superficie de carrera en algunas sesiones fáciles cuando sea viable, sin imponer una cuota respaldada por evidencia.

## 11. Reglas de seguridad

- Parar y mostrar acción de consulta urgente o sanitaria apropiada ante dolor torácico, síncope, falta de aire anormal, palpitaciones sintomáticas, fiebre, síntomas neurológicos, incapacidad de apoyar, hinchazón importante, dolor agudo/progresivo o marcha alterada. No ajustar ritmos para «entrenar alrededor» de una alarma.
- Dolor localizado que aumenta durante carrera, cambia la zancada o continúa al día siguiente: cancelar intensidad/carrera y sugerir evaluación. No diagnosticar tendinopatía, fractura por estrés u otra lesión.
- Si hay enfermedad reciente, reanudar por pasos tras resolución y con reducción; el algoritmo no puede fijar alta clínica.
- Sin datos suficientes, preferir plan más fácil y comunicar incertidumbre. No prometer prevención de lesiones.

## 12. Interfaz, trazabilidad y aceptación

Cada plan debe exponer: nivel asignado y hechos usados, semanas restantes/mínimas, fase, días disponibles, entorno por sesión, zona/RPE, fuente y fecha de cada ritmo, sesiones fáciles/calidad, suma temporal, descargas, riesgos y alternativas.

Conservar para cada decisión `ruleId`, versión, entradas relevantes, operación, resultado y motivo legible. El plan debe poder regenerarse exactamente desde `inputSnapshot + algorithmVersion + rulesetVersion`. Registrar fecha/hora por separado; no dejarla afectar el contenido del plan.

### Casos de aceptación funcional

1. Mismos datos y versiones producen idéntico conjunto ordenado de sesiones.
2. Ningún ritmo numérico aparece si no hay fuente válida y fechada; existe alternativa por RPE.
3. Toda suma de calentamiento, trabajo, pausas y enfriamiento cuadra exactamente con la duración mostrada.
4. Los minutos y repeticiones son enteros; distancias/velocidades usan solo la precisión definida arriba.
5. Una fecha inferior al mínimo bloquea la selección y enseña banner con fecha mínima calculada.
6. El mínimo cambia según base/reinicio y muestra el criterio responsable.
7. Los días disponibles, límite de tiempo y al menos un día de recuperación se respetan sin borrar una sesión clave silenciosamente.
8. No hay dos días consecutivos de calidad; la excepción solo se activa por configuración explícita y evidencia del historial.
9. Descargas se expresan en minutos exactos enteros y se distinguen del taper.
10. Ninguna sesión larga supera un límite derivado de la tirada reciente/base sin una razón y aviso explícitos.
11. Una sesión en cinta y otra exterior tienen instrucciones, unidades y contexto separados, aunque compartan la intención de esfuerzo.
12. Dolor que altera marcha o una bandera roja pausa el plan automáticamente.
13. Sesiones omitidas no se acumulan ni cambian de forma aleatoria el resto de la semana.
14. Un 7% de 197 minutos no se muestra como 13,79 min: la duración final sale de bloques enteros planificados, no de un decimal multiplicado.

## 13. Referencias centrales

- Damsted et al. (2018), revisión sistemática cambios de carga y lesiones: [PubMed](https://pubmed.ncbi.nlm.nih.gov/30534459/).
- Buist et al. (Run Clever, 2018), ensayo aleatorizado progresión de volumen/intensidad: [PubMed](https://pubmed.ncbi.nlm.nih.gov/29895234/).
- Festa et al. (2020), distribución de intensidad en corredores recreativos: [PubMed](https://pubmed.ncbi.nlm.nih.gov/33344993/).
- Wang et al. (2023), metaanálisis de taper en resistencia: [PLOS ONE texto completo](https://pmc.ncbi.nlm.nih.gov/articles/PMC10171681/).
- Bosquet et al. (2007), metaanálisis de taper: [PubMed](https://pubmed.ncbi.nlm.nih.gov/17762369/).
- Hespanhol et al. (2020), volumen/tirada larga y rendimiento/lesiones en media maratón: [PubMed](https://pubmed.ncbi.nlm.nih.gov/32421886/).
- Van Hooren et al. (2019), revisión/metaanálisis fisiología, percepción y rendimiento cinta/exterior: [PubMed](https://pubmed.ncbi.nlm.nih.gov/30847825/).
- Van Hooren et al. (2020), revisión/metaanálisis biomecánica cinta/exterior: [texto completo](https://pmc.ncbi.nlm.nih.gov/articles/PMC7069922/).
- Jones & Doust (1996), estudio de coste energético y pendiente de cinta: [PubMed](https://pubmed.ncbi.nlm.nih.gov/8887211/).
- Van Hooren & Peake (2018), revisión de enfriamiento activo: [texto completo](https://pmc.ncbi.nlm.nih.gov/articles/PMC5999142/).

**Fecha de revisión bibliográfica:** 1 de octubre de 2026. Esta especificación debe revisarse cuando se incorporen nuevas distancias, población juvenil, lesión/retorno al deporte o prescripción clínica.

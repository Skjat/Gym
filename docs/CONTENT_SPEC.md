# Спецификация контента: упражнения и программы

Все тексты — на русском языке, грамотно, кратко и по делу. Техника должна быть
безопасной и соответствовать общепринятым методикам (ACSM/NSCA, классическая хатха-йога).
Никаких выдуманных медицинских утверждений.

## Словари (используйте ТОЛЬКО эти значения)

### disciplines
`strength` (силовая), `calisthenics` (воркаут / собственный вес), `hiit` (HIIT / функциональная),
`plyometrics` (плиометрика), `running` (бег), `cardio` (кардио), `yoga` (йога),
`stretching` (растяжка), `mobility` (мобильность / суставная), `pilates` (пилатес),
`breathing` (дыхание / медитация), `recovery` (восстановление / МФР)

### locations
`gym` (зал), `home` (дом), `outdoor` (улица)

### muscles (primaryMuscles / secondaryMuscles)
`chest`, `lats`, `upper_back`, `lower_back`, `traps`, `shoulders`, `rear_delts`, `biceps`,
`triceps`, `forearms`, `abs`, `obliques`, `glutes`, `quads`, `hamstrings`, `adductors`,
`abductors`, `calves`, `hip_flexors`, `neck`

### equipment
`none` (только вес тела), `barbell`, `dumbbell`, `kettlebell`, `ez_bar`, `machine`, `cable`,
`bench`, `pullup_bar`, `parallel_bars`, `bands`, `mat`, `foam_roller`, `medicine_ball`,
`fitball`, `jump_rope`, `trx`, `box`, `yoga_block`, `yoga_strap`, `treadmill`, `bike`,
`rower`, `elliptical`, `sled`, `battle_rope`, `plate`, `wall`, `stairs`

### qualities (что развивает)
`strength` (сила), `hypertrophy` (мышечная масса), `power` (взрывная сила),
`endurance` (мышечная выносливость), `cardio` (аэробная выносливость), `flexibility` (гибкость),
`mobility` (подвижность суставов), `balance` (баланс), `coordination` (координация),
`stability` (стабилизация / кор), `speed` (скорость), `agility` (ловкость),
`posture` (осанка), `relaxation` (расслабление)

### difficulty
`beginner`, `intermediate`, `advanced`

### measure
`reps` (повторы), `time` (время / удержание), `distance` (дистанция)

## Упражнение (exercise)

Файл — JSON-массив объектов. Пример:

```json
{
  "id": "barbell_back_squat",
  "name": "Приседания со штангой на спине",
  "nameEn": "Barbell Back Squat",
  "disciplines": ["strength"],
  "locations": ["gym"],
  "primaryMuscles": ["quads", "glutes"],
  "secondaryMuscles": ["hamstrings", "adductors", "lower_back", "abs"],
  "equipment": ["barbell"],
  "qualities": ["strength", "hypertrophy", "stability"],
  "difficulty": "intermediate",
  "measure": "reps",
  "weighted": true,
  "unilateral": false,
  "description": "Базовое упражнение для ног и ягодиц. ... (2–3 предложения: что это и зачем)",
  "steps": ["Шаг 1 ...", "Шаг 2 ...", "..."],
  "tips": ["...", "..."],
  "mistakes": ["...", "..."],
  "breathing": "Вдох на опускании, выдох на подъёме ...",
  "contraindications": "Острые боли в пояснице и коленях ...",
  "variations": ["Проще: приседания с гантелью у груди (goblet)", "Сложнее: пауза в нижней точке"],
  "fedb": "Barbell_Squat",
  "videoQuery": "приседания со штангой техника",
  "defaults": { "sets": 4, "reps": "6-8", "restSec": 150 }
}
```

Правила полей:

- `id` — ровно тот, что указан в задании (snake_case латиницей). Не придумывайте другие.
- `name` — русское название; для асан: «Собака мордой вниз (Адхо Мукха Шванасана)».
- `nameEn` — английское название.
- `sanskrit` — только для йоги, необязательно (латиницей: "Adho Mukha Svanasana").
- `steps` — 4–7 шагов, повелительное наклонение («Поставьте стопы…»).
- `tips` — 2–4 совета по технике / ощущениям («Почувствуйте…»).
- `mistakes` — 2–4 частые ошибки.
- `breathing` — 1 предложение.
- `contraindications` — необязательно, 1 предложение, если есть реальные ограничения.
- `variations` — 1–3 строки: как упростить / усложнить.
- `fedb` — ID упражнения из открытой базы free-exercise-db (у неё есть 2 кадра-фото:
  исходное и конечное положение). Ставьте ТОЛЬКО если упражнение в базе действительно то же
  самое (проверяйте по файлу базы: поле `id`, `name`, `instructions`). Иначе — `null`.
- `videoQuery` — поисковый запрос для YouTube на русском, по которому найдётся видео техники.
- `defaults` — разумные параметры по умолчанию:
  для `reps`: `{ "sets": 3, "reps": "10-12", "restSec": 90 }`;
  для `time`: `{ "sets": 3, "durationSec": 30, "restSec": 30 }` (для асан: `{ "sets": 1, "durationSec": 45 }`);
  для `distance`/бега: `{ "durationSec": 1800 }` или `{ "distanceM": 400, "sets": 6, "restSec": 90 }`.
- `weighted` — true, если обычно выполняется с отягощением (вводится вес).
- `unilateral` — true, если выполняется на каждую сторону отдельно.
- Для бега/кардио дополнительно `"hrZone": 2` (типичная зона пульса 1–5) — необязательно.

## Программа (program)

Файл — JSON-массив программ:

```json
{
  "id": "gym_fullbody_beginner",
  "title": "Фулбади для новичка",
  "subtitle": "3 тренировки в неделю, всё тело",
  "discipline": "strength",
  "locations": ["gym"],
  "level": "beginner",
  "goal": "Освоить базовые движения и набрать силу",
  "description": "2–4 предложения о программе.",
  "weeks": 8,
  "sessionsPerWeek": 3,
  "equipment": ["barbell", "dumbbell", "machine", "bench"],
  "qualities": ["strength", "hypertrophy"],
  "schedule": "Пн — A, Ср — B, Пт — A; следующая неделя B/A/B.",
  "progression": "Как повышать нагрузку от недели к неделе.",
  "workouts": [
    {
      "id": "gym_fullbody_beginner_a",
      "title": "Тренировка A",
      "focus": "Всё тело: присед, жим, тяга",
      "estimatedMinutes": 55,
      "intensity": "moderate",
      "notes": "Необязательная заметка.",
      "blocks": [
        {
          "title": "Разминка",
          "kind": "warmup",
          "rounds": 1,
          "items": [
            { "exerciseId": "arm_circles", "sets": 1, "durationSec": 30 },
            { "exerciseId": "air_squat", "sets": 1, "reps": "15" }
          ]
        },
        {
          "title": "Основная часть",
          "kind": "main",
          "rounds": 1,
          "items": [
            { "exerciseId": "barbell_back_squat", "sets": 3, "reps": "8", "restSec": 120,
              "load": "RPE 7, оставляйте 3 повтора в запасе" }
          ]
        },
        {
          "title": "Круг",
          "kind": "circuit",
          "rounds": 3,
          "restBetweenRoundsSec": 60,
          "items": [
            { "exerciseId": "push_up", "reps": "10", "restSec": 0 },
            { "exerciseId": "plank", "durationSec": 30, "restSec": 15 }
          ]
        },
        {
          "title": "Заминка",
          "kind": "cooldown",
          "rounds": 1,
          "items": [
            { "exerciseId": "standing_quad_stretch", "durationSec": 30, "side": "each" }
          ]
        }
      ]
    }
  ]
}
```

Правила:

- `kind`: `warmup` | `main` | `circuit` | `interval` | `cooldown`.
- `intensity`: `easy` | `moderate` | `hard`.
- В `items` — поля: `exerciseId` (обязательно, только из списка ID), `sets` (по умолчанию 1),
  `reps` (строка: "10", "8-12", "макс"), `durationSec`, `distanceM`, `restSec` (отдых после
  каждого подхода), `load` (строка: "RPE 7", "70% 1ПМ", "лёгкие гантели"), `tempo` ("3-1-1"),
  `side` (`"each"` — на каждую сторону), `hrZone` (1–5), `notes`.
- Для кругов (`circuit`) и интервалов (`interval`) используйте `rounds` > 1, `sets` у элементов = 1.
- Беговые интервалы: блок `interval`, `rounds: 6`, элементы
  `{ "exerciseId": "interval_run", "distanceM": 400, "hrZone": 4, "notes": "темп 5 км" }` и
  `{ "exerciseId": "easy_run", "durationSec": 90, "hrZone": 1, "notes": "трусцой" }`.
- Йога: последовательность асан с `durationSec` (удержание) и `side: "each"` для асимметричных.
- В каждой программе 1–4 тренировки-шаблона. Тренировки должны быть реалистичными по времени.

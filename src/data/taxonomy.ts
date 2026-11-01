export interface Tag {
  id: string;
  label: string;
  icon?: string;
}

const tags = (list: [string, string, string?][]): Tag[] =>
  list.map(([id, label, icon]) => ({ id, label, icon }));

export const DISCIPLINES = tags([
  ['strength', 'Силовая', '🏋️'],
  ['calisthenics', 'Воркаут', '🤸'],
  ['hiit', 'HIIT / функционал', '⚡'],
  ['plyometrics', 'Плиометрика', '🦘'],
  ['running', 'Бег', '🏃'],
  ['cardio', 'Кардио', '❤️'],
  ['yoga', 'Йога', '🧘'],
  ['stretching', 'Растяжка', '🙆'],
  ['mobility', 'Мобильность', '🔄'],
  ['pilates', 'Пилатес', '🌀'],
  ['breathing', 'Дыхание', '🌬️'],
  ['recovery', 'Восстановление', '🛁'],
]);

export const LOCATIONS = tags([
  ['gym', 'Зал', '🏢'],
  ['home', 'Дом', '🏠'],
  ['outdoor', 'Улица', '🌳'],
]);

export const MUSCLES = tags([
  ['chest', 'Грудь'],
  ['lats', 'Широчайшие'],
  ['upper_back', 'Верх спины'],
  ['lower_back', 'Поясница'],
  ['traps', 'Трапеции'],
  ['shoulders', 'Плечи'],
  ['rear_delts', 'Задние дельты'],
  ['biceps', 'Бицепс'],
  ['triceps', 'Трицепс'],
  ['forearms', 'Предплечья'],
  ['abs', 'Пресс'],
  ['obliques', 'Косые мышцы'],
  ['glutes', 'Ягодицы'],
  ['quads', 'Квадрицепс'],
  ['hamstrings', 'Бицепс бедра'],
  ['adductors', 'Приводящие'],
  ['abductors', 'Отводящие'],
  ['calves', 'Икры'],
  ['hip_flexors', 'Сгибатели бедра'],
  ['neck', 'Шея'],
]);

export const EQUIPMENT = tags([
  ['none', 'Без инвентаря'],
  ['barbell', 'Штанга'],
  ['dumbbell', 'Гантели'],
  ['kettlebell', 'Гиря'],
  ['ez_bar', 'EZ-гриф'],
  ['machine', 'Тренажёр'],
  ['cable', 'Блок / кроссовер'],
  ['bench', 'Скамья'],
  ['pullup_bar', 'Турник'],
  ['parallel_bars', 'Брусья'],
  ['bands', 'Резинки'],
  ['mat', 'Коврик'],
  ['foam_roller', 'Ролл (МФР)'],
  ['medicine_ball', 'Медбол'],
  ['fitball', 'Фитбол'],
  ['jump_rope', 'Скакалка'],
  ['trx', 'Петли TRX'],
  ['box', 'Тумба / степ'],
  ['yoga_block', 'Блок для йоги'],
  ['yoga_strap', 'Ремень для йоги'],
  ['treadmill', 'Беговая дорожка'],
  ['bike', 'Велотренажёр'],
  ['rower', 'Гребной тренажёр'],
  ['elliptical', 'Эллипс'],
  ['sled', 'Сани'],
  ['battle_rope', 'Канаты'],
  ['plate', 'Блин'],
  ['wall', 'Стена'],
  ['stairs', 'Лестница'],
]);

export const QUALITIES = tags([
  ['strength', 'Сила', '💪'],
  ['hypertrophy', 'Масса', '🧱'],
  ['power', 'Взрывная сила', '💥'],
  ['endurance', 'Выносливость мышц', '🔁'],
  ['cardio', 'Аэробная выносливость', '🫀'],
  ['flexibility', 'Гибкость', '🙆'],
  ['mobility', 'Подвижность', '🔄'],
  ['balance', 'Баланс', '⚖️'],
  ['coordination', 'Координация', '🎯'],
  ['stability', 'Стабилизация / кор', '🧭'],
  ['speed', 'Скорость', '🏎️'],
  ['agility', 'Ловкость', '🐆'],
  ['posture', 'Осанка', '🧍'],
  ['relaxation', 'Расслабление', '😌'],
]);

export const DIFFICULTIES = tags([
  ['beginner', 'Новичок'],
  ['intermediate', 'Средний'],
  ['advanced', 'Продвинутый'],
]);

export const INTENSITIES: Record<string, string> = {
  easy: 'Лёгкая',
  moderate: 'Средняя',
  hard: 'Тяжёлая',
  rest: 'Отдых',
};

export const BLOCK_KINDS: Record<string, string> = {
  warmup: 'Разминка',
  main: 'Основная часть',
  circuit: 'Круговая',
  interval: 'Интервалы',
  cooldown: 'Заминка',
};

const index = (list: Tag[]) => Object.fromEntries(list.map((t) => [t.id, t]));
const IDX = {
  discipline: index(DISCIPLINES),
  location: index(LOCATIONS),
  muscle: index(MUSCLES),
  equipment: index(EQUIPMENT),
  quality: index(QUALITIES),
  difficulty: index(DIFFICULTIES),
};

export type TagKind = keyof typeof IDX;

export function tagLabel(kind: TagKind, id: string | undefined): string {
  if (!id) return '';
  return IDX[kind][id]?.label ?? id;
}

export function tagIcon(kind: TagKind, id: string | undefined): string {
  if (!id) return '';
  return IDX[kind][id]?.icon ?? '';
}

export function disciplineIcon(id?: string): string {
  return tagIcon('discipline', id) || '🏋️';
}

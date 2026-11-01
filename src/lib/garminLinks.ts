import type { GarminActivity } from '../types';

const LINK_RE = /https?:\/\/[^\s]*garmin[^\s]*/gi;
const ID_RE = /activit(?:y|ies)\/(\d{5,})/i;

/**
 * Garmin Connect links can't be opened by the app or by Claude: the page loads its data only after
 * signing in. If the activity is already in the synced data, point the coach at it; otherwise tell
 * the coach to ask for screenshots.
 */
export function garminLinkNote(text: string, activities: GarminActivity[]): string | undefined {
  const links = text.match(LINK_RE);
  if (!links?.length) return undefined;
  const notes = links.map((link) => {
    const id = link.match(ID_RE)?.[1];
    const synced = id ? activities.find((a) => a.id === id) : undefined;
    if (synced) {
      return `Ссылка на активность Garmin ${id} («${synced.name}», ${synced.start.slice(0, 16).replace('T', ' ')}) — она есть в синхронизированных данных, подробности через get_garmin_activity с activityId "${id}".`;
    }
    return `Пользователь прислал ссылку на Garmin Connect${id ? ` (активность ${id})` : ''}. Открыть её нельзя: данные на странице Garmin Connect загружаются только после входа в аккаунт, и в синхронизированных данных этой активности нет. Если скриншотов в сообщении нет — попроси прислать скриншоты активности из приложения Garmin Connect (сводка, пульс и зоны, отрезки/круги, Training Effect).`;
  });
  return `<ссылки>\n${notes.join('\n')}\n</ссылки>`;
}

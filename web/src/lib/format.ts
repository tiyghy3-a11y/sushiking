const JST = 'Asia/Tokyo';

export const formatDate = (iso: string | null): string => {
  if (!iso) return '日付不明';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00+09:00` : iso);
  if (!Number.isFinite(d.getTime())) return '日付不明';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: JST,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
};

export const formatDateRange = (start: string, end: string): string =>
  start === end ? formatDate(start) : `${formatDate(start)} 〜 ${formatDate(end)}`;

export const formatTime = (iso: string | null): string => {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '--:--';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: JST,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

export const formatDuration = (sec: number): string => {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}時間${String(m).padStart(2, '0')}分` : `${m}分`;
};

export const formatDistance = (m: number): string =>
  m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

export const formatElevation = (m: number | null): string =>
  m == null ? '—' : `${Math.round(m).toLocaleString('ja-JP')} m`;

export const formatPace = (mPerH: number | null): string =>
  mPerH == null ? '—' : `${(mPerH / 1000).toFixed(1)} km/h`;

export const formatOffset = (sec: number): string => {
  if (sec === 0) return '±0秒';
  const sign = sec > 0 ? '+' : '−';
  const abs = Math.abs(sec);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const parts = [h ? `${h}時間` : '', m ? `${m}分` : '', s ? `${s}秒` : ''].filter(Boolean);
  return `${sign}${parts.join('') || '0秒'}`;
};

export const coordSourceLabel: Record<string, string> = {
  exif: 'EXIF',
  interpolated: '補間',
  manual: '手動',
  none: '座標なし',
};

export const timeSourceLabel: Record<string, string> = {
  exif: 'EXIF',
  file: 'ファイル日時',
  manual: '手入力',
  none: '不明',
};

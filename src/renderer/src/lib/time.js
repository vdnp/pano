const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });

export function relativeTime(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = (ts - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'az önce';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dayLabel(ts) {
  const day = startOfDay(new Date(ts));
  const today = startOfDay(new Date());
  if (day === today) return 'Bugün';
  if (day === today - 86400000) return 'Dün';
  return new Date(ts).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export const clock = (ts) =>
  new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

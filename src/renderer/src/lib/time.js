const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// Göreli zaman, gün başlığı ve saat; seçili dilin biçimleriyle
export function createTimeFormat({ locale, t }) {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  function relativeTime(ts, now = Date.now()) {
    if (!ts) return '';
    const diff = (ts - now) / 1000;
    const abs = Math.abs(diff);
    if (abs < 45) return t('time.justNow');
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    return rtf.format(Math.round(diff / 86400), 'day');
  }

  function dayLabel(ts) {
    const day = startOfDay(new Date(ts));
    const today = startOfDay(new Date());
    if (day === today) return t('time.today');
    if (day === today - 86400000) return t('time.yesterday');
    return new Date(ts).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  }

  const clock = (ts) => new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  return { relativeTime, dayLabel, clock };
}

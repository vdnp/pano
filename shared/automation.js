// Otomasyonun core ve arayüzde ortak sabitleri (saf JS). Sınır değişirse iki taraf birlikte değişir.

// Kural başına kayan pencerede en fazla çalışma; zincirle (döngü olasılığı) aşılırsa kural kapanır
export const RATE_LIMIT = 10;
export const RATE_WINDOW_MS = 60_000;
export const MAX_RULES = 100;
export const MAX_CONDITIONS = 10;
export const MAX_ACTIONS = 5;
export const OPERATORS = ['eq', 'neq', 'contains', 'matches', 'in'];
// Koşul alanları: bildirim şemasının alanları (ve meta.*)
export const NOTIFICATION_FIELDS = ['source', 'level', 'title', 'body', 'url', 'job', 'tags'];

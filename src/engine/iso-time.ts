export function toIsoLocal(d: Date = new Date()): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  const offsetMin = -d.getTimezoneOffset();
  const offsetSign = offsetMin >= 0 ? '+' : '-';
  const offsetH = pad(Math.floor(Math.abs(offsetMin) / 60));
  const offsetM = pad(Math.abs(offsetMin) % 60);
  const ms = pad(d.getMilliseconds(), 3);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}` +
    `${offsetSign}${offsetH}:${offsetM}`
  );
}

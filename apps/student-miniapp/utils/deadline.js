function dateParts(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? { month: Number(match[2]), day: Number(match[3]) } : null;
}

function formatDeadline(value, precision) {
  if (!value) return '待确认';
  const parts = dateParts(value);
  if (parts && (precision === 'day' || /^\d{4}-\d{2}-\d{2}$/.test(String(value))))
    return `${parts.month}月${parts.day}日`;
  const timed = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (timed)
    return `${Number(timed[2])}月${Number(timed[3])}日 ${timed[4]}:${timed[5]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function shanghaiDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function homeBucket(value, precision, now) {
  if (!value) return 'later';
  const current = now || new Date();
  const parts = dateParts(value);
  if (!parts) return 'later';
  const dateKey = `${String(value).slice(0, 4)}-${String(value).slice(5, 7)}-${String(value).slice(8, 10)}`;
  if (dateKey === shanghaiDateKey(current)) return 'today';
  const due = new Date(
    precision === 'day' || /^\d{4}-\d{2}-\d{2}$/.test(String(value))
      ? `${dateKey}T23:59:59+08:00`
      : value,
  );
  const horizon = new Date(current.getTime() + 3 * 24 * 60 * 60 * 1000);
  return due > current && due <= horizon ? 'upcoming' : 'later';
}

module.exports = { formatDeadline, homeBucket };


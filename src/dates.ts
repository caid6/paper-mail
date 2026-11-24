const calendarDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

// PubMed 可只提供年或年月；保留原始精度，不补写不存在的日期。
export function formatDate(value: string): string {
  if (!value) return '未提供';
  if (/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const parts = calendarDate.formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}

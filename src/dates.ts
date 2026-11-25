const calendarDates = new Map<string, Intl.DateTimeFormat>();

// PubMed 日期保留原始精度。只有带时区的时间戳需要转换成当地日历日期。
export function formatDate(value: string, timeZone = 'Asia/Shanghai'): string {
  if (!value) return '未提供';
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  let calendarDate = calendarDates.get(timeZone);
  if (!calendarDate) {
    calendarDate = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    calendarDates.set(timeZone, calendarDate);
  }
  const parts = calendarDate.formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}

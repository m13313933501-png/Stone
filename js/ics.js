// 生成日历订阅文件（.ics），纯函数、无 DOM 依赖，便于测试
function icsDate(d) { return d.replace(/-/g, ''); }

function nextDay(d) {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString().slice(0, 10).replace(/-/g, '');
}

export function buildICS(jobs) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Qiuzhao//CN', 'CALSCALE:GREGORIAN'];
  for (const j of jobs) {
    if (!j.deadline) continue;
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + j.id + '@qiuzhao',
      'DTSTART;VALUE=DATE:' + icsDate(j.deadline),
      'DTEND;VALUE=DATE:' + nextDay(j.deadline),
      'SUMMARY:秋招截止 ' + j.company + ' ' + j.jobTitle,
      'DESCRIPTION:投递入口 ' + (j.applyUrl || '') + '\\n官网 ' + (j.officialUrl || ''),
      'BEGIN:VALARM', 'TRIGGER:-P3D', 'ACTION:DISPLAY', 'DESCRIPTION:' + j.company + ' ' + j.jobTitle + ' 还有3天截止', 'END:VALARM',
      'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:' + j.company + ' ' + j.jobTitle + ' 明天截止', 'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

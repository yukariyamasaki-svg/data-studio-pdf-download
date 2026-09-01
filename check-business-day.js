const holidayJp = require('@holiday-jp/holiday_jp');

// PDF自動生成（GitHub Actions）を「毎月第三営業日」だけ実行するための判定スクリプト。
// 土日・日本の祝日を除いた営業日で数える。cronは月初の数日間毎日実行され、
// このスクリプトがtrueを返した日だけ実際のダウンロード処理に進む。
function isBusinessDay(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  if (holidayJp.isHoliday(date)) return false;
  return true;
}

function businessDayNumberOfMonth(date) {
  let count = 0;
  for (let d = 1; d <= date.getDate(); d++) {
    const day = new Date(date.getFullYear(), date.getMonth(), d);
    if (isBusinessDay(day)) count++;
  }
  return count;
}

function nowInJst() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
}

const today = nowInJst();
const isThirdBusinessDay = isBusinessDay(today) && businessDayNumberOfMonth(today) === 3;

console.log(isThirdBusinessDay ? 'true' : 'false');

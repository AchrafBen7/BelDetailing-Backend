export function getMonthRange(month) {
  // month = "YYYY-MM"
  const [year, m] = month.split("-").map(Number);

  const start = new Date(Date.UTC(year, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, m, 0, 23, 59, 59));
  // m,0 = last day of previous month

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

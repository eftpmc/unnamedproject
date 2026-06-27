export function startScheduler(): NodeJS.Timeout {
  // Trigger polling is wired in Task 5 (triggerRunner).
  return setInterval(() => {}, 60 * 60 * 1000);
}

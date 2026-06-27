import parser from 'cron-parser';

export function nextCronRun(cron: string, afterUnixSeconds: number): number {
  const interval = parser.parseExpression(cron, {
    currentDate: new Date(afterUnixSeconds * 1000),
    tz: 'UTC',
  });
  return Math.floor(interval.next().getTime() / 1000);
}

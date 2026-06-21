// Minimal structured logger — no dependency, JSON lines in production (so a log
// collector can parse them) and a readable single line in development. Level is
// controlled by LOG_LEVEL (debug|info|warn|error); tests default to 'error' to
// keep output quiet.

type Level = 'debug' | 'info' | 'warn' | 'error';
type Meta = Record<string, unknown>;

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = process.env.LOG_LEVEL as Level | undefined;
  if (configured && configured in LEVELS) return LEVELS[configured];
  if (process.env.NODE_ENV === 'test') return LEVELS.error;
  return LEVELS.info;
}

const pretty = process.env.NODE_ENV !== 'production';

function emit(level: Level, msg: string, meta?: Meta): void {
  if (LEVELS[level] < threshold()) return;
  const time = new Date().toISOString();
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (pretty) {
    const tail = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    sink(`${time} ${level.toUpperCase().padEnd(5)} ${msg}${tail}`);
  } else {
    sink(JSON.stringify({ time, level, msg, ...meta }));
  }
}

export const logger = {
  debug: (msg: string, meta?: Meta) => emit('debug', msg, meta),
  info: (msg: string, meta?: Meta) => emit('info', msg, meta),
  warn: (msg: string, meta?: Meta) => emit('warn', msg, meta),
  error: (msg: string, meta?: Meta) => emit('error', msg, meta),
};

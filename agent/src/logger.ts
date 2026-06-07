// Минимальный structured logger. JSON-output облегчает grep/jq в
// /var/log/xray-sync.log и parse'инг алертов из journalctl. По уровню
// фильтруем через ENV LOG_LEVEL (по умолчанию `info` — DEBUG исключается).

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogMeta = object | undefined;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info';
const MIN_VALUE = LEVELS[MIN_LEVEL] ?? LEVELS.info;

function emit(level: LogLevel, msg: string, meta?: LogMeta): void {
  if (LEVELS[level] < MIN_VALUE) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta ?? {}),
  };
  // stderr для warn/error чтобы systemd journal различал severity;
  // stdout для info/debug.
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(entry) + '\n');
}

export const log = {
  debug: (msg: string, meta?: LogMeta) => emit('debug', msg, meta),
  info: (msg: string, meta?: LogMeta) => emit('info', msg, meta),
  warn: (msg: string, meta?: LogMeta) => emit('warn', msg, meta),
  error: (msg: string, meta?: LogMeta) => emit('error', msg, meta),
};

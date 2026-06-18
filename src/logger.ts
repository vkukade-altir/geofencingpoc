function stringifyLogValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      stack: value.stack,
    });
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatLogArgs(args: unknown[]): string[] {
  return args.map(stringifyLogValue);
}

export const log = (...args: unknown[]) => console.log(...formatLogArgs(args));
export const warn = (...args: unknown[]) => console.warn(...formatLogArgs(args));
export const logError = (...args: unknown[]) =>
  console.error(...formatLogArgs(args));

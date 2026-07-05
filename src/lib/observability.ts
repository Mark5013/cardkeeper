import "server-only";

type LogFields = Record<string, unknown>;

function getNumericEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    const cause = error.cause;
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
      cause: cause instanceof Error ? { name: cause.name, message: cause.message } : cause,
    };
  }

  return error;
}

function hasDbSaturationSignal(error: unknown) {
  const serialized = JSON.stringify(serializeError(error)).toLowerCase();
  return (
    serialized.includes("emaxconnsession") ||
    serialized.includes("too many clients") ||
    serialized.includes("remaining connection slots") ||
    serialized.includes("max clients") ||
    serialized.includes("connection terminated")
  );
}

export function logInfo(event: string, fields: LogFields = {}) {
  console.info(JSON.stringify({ level: "info", event, ...fields }));
}

export function logWarn(event: string, fields: LogFields = {}) {
  console.warn(JSON.stringify({ level: "warn", event, ...fields }));
}

export function logError(event: string, error: unknown, fields: LogFields = {}) {
  console.error(
    JSON.stringify({
      level: "error",
      event,
      ...fields,
      dbSaturationSignal: hasDbSaturationSignal(error) || undefined,
      error: serializeError(error),
    }),
  );
}

export async function measureOperation<T>(
  event: string,
  operation: () => Promise<T>,
  fields: LogFields = {},
  slowMs = getNumericEnv("SERVER_SLOW_OPERATION_MS", 1000),
) {
  const startedAt = performance.now();

  try {
    return await operation();
  } catch (error) {
    logError(`${event}.failed`, error, {
      ...fields,
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw error;
  } finally {
    const durationMs = Math.round(performance.now() - startedAt);
    if (durationMs >= slowMs) {
      logWarn(`${event}.slow`, { ...fields, durationMs, slowMs });
    }
  }
}

export function measureDbQuery<T>(
  event: string,
  operation: () => Promise<T>,
  fields: LogFields = {},
) {
  return measureOperation(event, operation, fields, getNumericEnv("DATABASE_SLOW_QUERY_MS", 750));
}

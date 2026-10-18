import { NextResponse, type NextRequest } from "next/server";
import { MongoNetworkError, MongoServerSelectionError } from "mongodb";
import { getCorrelationId, log, serializeError } from "@/lib/logger";

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: { code: string; message: string; fieldErrors?: Record<string, string[]>; correlationId: string };
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: { fieldErrors?: Record<string, string[]>; headers?: Record<string, string> } = {},
  ) {
    super(message);
  }
}

export interface RouteContext {
  correlationId: string;
}

/**
 * Wraps a route handler: attaches a correlation ID, converts known errors into the standard
 * JSON envelope, and turns anything unexpected into a generic 500 (details go to logs only).
 */
export async function handleRoute<T>(
  req: NextRequest,
  handler: (ctx: RouteContext) => Promise<{ status?: number; data: T; headers?: Record<string, string> }>,
): Promise<NextResponse> {
  const correlationId = getCorrelationId(req.headers);
  const baseHeaders = { "x-correlation-id": correlationId, "Cache-Control": "no-store" };
  try {
    const result = await handler({ correlationId });
    return NextResponse.json<ApiSuccess<T>>(
      { ok: true, data: result.data },
      { status: result.status ?? 200, headers: { ...baseHeaders, ...result.headers } },
    );
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json<ApiFailure>(
        {
          ok: false,
          error: { code: err.code, message: err.message, fieldErrors: err.extra.fieldErrors, correlationId },
        },
        { status: err.status, headers: { ...baseHeaders, ...err.extra.headers } },
      );
    }
    const dbDown = err instanceof MongoServerSelectionError || err instanceof MongoNetworkError;
    log("error", dbDown ? "db.unavailable" : "route.unhandled", { correlationId, path: req.nextUrl.pathname, err: serializeError(err) });
    const status = dbDown ? 503 : 500;
    return NextResponse.json<ApiFailure>(
      {
        ok: false,
        error: {
          code: dbDown ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR",
          message: dbDown
            ? "The system is temporarily unavailable. Nothing was saved. Please try again in a minute."
            : "Something went wrong on our side. Please try again.",
          correlationId,
        },
      },
      { status, headers: baseHeaders },
    );
  }
}

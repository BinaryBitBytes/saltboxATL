import { NextResponse } from "next/server";
import { flattenError, ZodError } from "zod";
import { ServiceError } from "@/backend/server/inventory-service";

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function jsonError(error: unknown, fallbackStatus = 500) {
  if (error instanceof ServiceError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { success: false, errors: flattenError(error) },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { success: false, error: "Unexpected server error" },
    { status: fallbackStatus },
  );
}

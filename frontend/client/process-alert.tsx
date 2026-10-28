"use client";

import { T } from "@/frontend/client/language";

export function ProcessAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
    >
      <T>{message}</T>
    </div>
  );
}

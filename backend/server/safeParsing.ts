import { z, flattenError, prettifyError } from "zod";

export type ParseFailure = {
  success: false;
  error: string;
  fieldErrors: Record<string, string[]>;
};

export type ParseSuccess<T> = {
  success: true;
  data: T;
};

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  incomingData: unknown,
): ParseResult<T> {
  const result = schema.safeParse(incomingData);

  if (!result.success) {
    const flattened = flattenError(result.error);
    const fieldErrors: Record<string, string[]> = {};

    for (const [key, messages] of Object.entries(flattened.fieldErrors)) {
      const list = Array.isArray(messages)
        ? messages.filter((message): message is string => Boolean(message))
        : [];
      if (list.length > 0) fieldErrors[key] = list;
    }

    return {
      success: false,
      error: prettifyError(result.error),
      fieldErrors,
    };
  }

  return { success: true, data: result.data };
}

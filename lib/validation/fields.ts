import { z } from "zod";
import { LIMITS } from "@/lib/validation/limits";
import {
  hasControlChars,
  hasHtmlMarkup,
  isPersonName,
  isSku,
  isUpc,
} from "@/lib/validation/sanitize";

const noControl = (value: string) => !hasControlChars(value);
const noMarkup = (value: string) => !hasHtmlMarkup(value);

export const SafeTextSchema = z
  .string()
  .trim()
  .min(1, { error: "Required." })
  .max(LIMITS.text, { error: `Must be ${LIMITS.text} characters or fewer.` })
  .refine(noControl, { error: "Control characters are not allowed." })
  .refine(noMarkup, { error: "HTML markup is not allowed." });

export const OptionalNotesSchema = z
  .string()
  .trim()
  .max(LIMITS.notes, { error: `Notes must be ${LIMITS.notes} characters or fewer.` })
  .refine(noControl, { error: "Control characters are not allowed." })
  .refine(noMarkup, { error: "HTML markup is not allowed." })
  .optional();

export const DescriptionSchema = z
  .string()
  .trim()
  .min(1, { error: "Required." })
  .max(LIMITS.description)
  .refine(noControl, { error: "Control characters are not allowed." })
  .refine(noMarkup, { error: "HTML markup is not allowed." });

export const ReasonSchema = z
  .string()
  .trim()
  .min(1, { error: "A reason is required." })
  .max(LIMITS.reason)
  .refine(noControl, { error: "Control characters are not allowed." })
  .refine(noMarkup, { error: "HTML markup is not allowed." });

export const PersonNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.name)
  .refine(noControl, { error: "Control characters are not allowed." })
  .refine(isPersonName, {
    error: "Names may only include letters, spaces, periods, apostrophes, and hyphens.",
  });

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(LIMITS.email)
  .pipe(z.email({ error: "Enter a valid email." }));

export const PasswordSchema = z
  .string()
  .min(LIMITS.passwordMin, {
    error: `Password must be at least ${LIMITS.passwordMin} characters.`,
  })
  .max(LIMITS.passwordMax, {
    error: `Password must be ${LIMITS.passwordMax} characters or fewer.`,
  })
  .regex(/[A-Za-z]/, { error: "Password must include a letter." })
  .regex(/[0-9]/, { error: "Password must include a number." });

export const LoginPasswordSchema = z
  .string()
  .min(1, { error: "Password is required." })
  .max(LIMITS.passwordMax);

export const SkuSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.sku)
  .refine(isSku, {
    error: "SKU may only include letters, numbers, dots, underscores, slashes, and hyphens.",
  });

export const UpcSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.upc)
  .refine(isUpc, {
    error: "UPC may only include letters, numbers, and hyphens.",
  });

export const LocationCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.code)
  .refine(isSku, {
    error: "Location codes may only include letters, numbers, dots, underscores, slashes, and hyphens.",
  });

export const QuantitySchema = z.coerce
  .number()
  .int({ error: "Quantity must be a whole number." })
  .min(1, { error: "Quantity must be at least 1." })
  .max(LIMITS.quantityMax, {
    error: `Quantity cannot exceed ${LIMITS.quantityMax}.`,
  });

export const NonNegativeCountSchema = z.coerce
  .number()
  .int({ error: "Count must be a whole number." })
  .min(0)
  .max(LIMITS.quantityMax, {
    error: `Count cannot exceed ${LIMITS.quantityMax}.`,
  });

export const LargeInputConfirmationSchema = z.object({
  confirmLargeInput: z.boolean().optional().default(false),
  confirmationQuantity: z.coerce.number().int().optional(),
});
export type LargeInputConfirmation = z.infer<typeof LargeInputConfirmationSchema>;

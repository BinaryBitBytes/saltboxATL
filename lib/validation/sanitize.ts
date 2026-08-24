const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const HTML_MARKUP = /<\/?[a-z][^>]*>/i;
const PERSON_NAME = /^[\p{L}][\p{L}\s.'-]*$/u;
const USERNAME = /^[a-z][a-z0-9._-]*$/;
const SKU_OR_CODE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const UPC = /^[A-Za-z0-9-]{1,32}$/;

export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value);
}

export function hasHtmlMarkup(value: string): boolean {
  return HTML_MARKUP.test(value);
}

export function isPersonName(value: string): boolean {
  return PERSON_NAME.test(value);
}

export function isUsername(value: string): boolean {
  return USERNAME.test(value);
}

export function isSku(value: string): boolean {
  return SKU_OR_CODE.test(value);
}

export function isUpc(value: string): boolean {
  return UPC.test(value);
}

export function stripNullBytes(value: string): string {
  return value.replace(/\u0000/g, "");
}

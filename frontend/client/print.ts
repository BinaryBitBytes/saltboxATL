"use client";

export function printNamedDocument(id: string) {
  const selector = `[data-print-root="${CSS.escape(id)}"]`;
  const root = document.querySelector(selector);
  if (!root) {
    window.print();
    return;
  }

  document
    .querySelectorAll("[data-print-active]")
    .forEach((node) => node.removeAttribute("data-print-active"));
  root.setAttribute("data-print-active", "");
  document.documentElement.setAttribute("data-print-doc", id);

  const cleanup = () => {
    root.removeAttribute("data-print-active");
    document.documentElement.removeAttribute("data-print-doc");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}

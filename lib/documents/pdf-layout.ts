/** Positioned text from a real PDF, including compressed content streams. */

export type PdfGlyph = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

type PdfJsModule = {
  getDocument: (source: {
    data: Uint8Array;
    disableWorker?: boolean;
    isEvalSupported?: boolean;
  }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> }> };
};

export async function readPdfGlyphs(bytes: Uint8Array): Promise<PdfGlyph[]> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJsModule;
  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    isEvalSupported: false,
  }).promise;
  const glyphs: PdfGlyph[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const entry of content.items) {
      if (!entry || typeof entry !== "object" || !("str" in entry)) continue;
      const item = entry as PdfTextItem;
      const text = item.str?.trim() ?? "";
      if (!text) continue;
      glyphs.push({
        text,
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
        width: item.width ?? 0,
        height: item.height || 9,
      });
    }
  }
  return glyphs;
}

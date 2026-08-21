const MAX_EDGE = 1600;
const QUALITY = 0.82;

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to compress that photo."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      QUALITY,
    );
  });
}

export async function compressProofPhoto(file: File): Promise<File> {
  if (file.size === 0) {
    throw new Error("That photo file is empty.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "Use a JPEG, PNG, or WebP photo. This device could not read that image.",
    );
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Unable to prepare that photo for upload.");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await canvasToJpeg(canvas);
  const name = file.name.replace(/\.[^.]+$/, "") || "photo";
  const compressed = new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  if (compressed.size <= file.size && file.type === "image/jpeg") {
    return compressed;
  }
  if (file.size <= compressed.size && file.type.startsWith("image/")) {
    return file;
  }
  return compressed;
}

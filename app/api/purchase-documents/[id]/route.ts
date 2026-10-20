import { NextResponse } from "next/server";
import { getPurchaseDocumentFile } from "@/backend/server/document-service";
import { requireApiPermission } from "@/backend/server/dal";
import { jsonError } from "@/backend/server/http";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiPermission("viewPurchaseDocuments");
    const { id } = await context.params;
    const { bytes } = await getPurchaseDocumentFile(id);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'inline; filename="purchase-document.pdf"',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

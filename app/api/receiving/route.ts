import { NextRequest, NextResponse } from "next/server";
import { ReceivingOrderSchema } from "@/lib/inventory-schema";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = ReceivingOrderSchema.parse(body); // throws on invalid

    // validated is now fully typed as ReceivingOrder
    // save to DB...

    return NextResponse.json({ success: true, data: validated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.flatten() },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
"use client";

import { T } from "@/frontend/client/language";
import { useState } from "react";
import { BuyerPoForm } from "@/frontend/client/buyer-po-form";
import { PurchaseDocumentUpload } from "@/frontend/client/purchase-document-upload";
import type { InboundReviewDraft } from "@/lib/documents/apply";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function InboundCapture() {
  const [draft, setDraft] = useState<(InboundReviewDraft & { version: number }) | null>(null);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle><T>Read purchase document</T></CardTitle>
          <CardDescription>
            <T>
              Read a purchase order or invoice PDF. The numbers in the Rate and Amount columns are blacked out, then the file is saved. Vendor, PO number, job number, and the MPN, description, and quantity lines are placed on the form below for review.
            </T>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PurchaseDocumentUpload
            onReview={(review) => setDraft({ ...review, version: Date.now() })}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle><T>Upload buyer PO</T></CardTitle>
          <CardDescription>
            <T>
              Review the parsed fields, fill the carrier and arrival, then save. Saving the same PO number updates the expected details and leaves a job ID that is already assigned.
            </T>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {draft ? (
            <p className="mb-3 text-sm text-muted-foreground">
              <T>Review these fields, then save the buyer PO.</T>
            </p>
          ) : null}
          <BuyerPoForm draft={draft} />
        </CardContent>
      </Card>
    </>
  );
}

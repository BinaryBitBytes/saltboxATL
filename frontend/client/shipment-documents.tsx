"use client";

import { DocumentBarcode, PrintDocument } from "@/frontend/client/print-document";
import type {
  LoadManifestDocument,
  PackSlipDocument,
} from "@/lib/shipping/documents";
import { formatDateTime } from "@/lib/format";

function DocumentHeader({
  eyebrow,
  title,
  fields,
  barcodeValue,
}: {
  eyebrow: string;
  title: string;
  fields: Array<{ label: string; value: string }>;
  barcodeValue: string;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black pb-3">
      <div>
        <p className="text-[0.65rem] font-semibold tracking-[0.16em] uppercase">
          Saltbox · {eyebrow}
        </p>
        <h2 className="mt-1 font-heading text-xl font-semibold">{title}</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          {fields.map((field) => (
            <div key={field.label}>
              <dt className="uppercase tracking-wide text-neutral-600">
                {field.label}
              </dt>
              <dd>{field.value || "—"}</dd>
            </div>
          ))}
        </dl>
      </div>
      <DocumentBarcode
        value={barcodeValue}
        label={`Barcode for ${barcodeValue}`}
      />
    </header>
  );
}

function SignatureRow({ labels }: { labels: string[] }) {
  return (
    <div className="mt-8 grid gap-6 sm:grid-cols-2">
      {labels.map((label) => (
        <div key={label} className="text-xs">
          <div className="h-8 border-b border-black" />
          <p className="mt-1 uppercase tracking-wide text-neutral-600">
            {label}
          </p>
        </div>
      ))}
    </div>
  );
}

export function PackSlipSheet({ doc }: { doc: PackSlipDocument }) {
  return (
    <PrintDocument
      id={`pack-slip-${doc.shipmentId}`}
      title="Packing slip"
      description="Print a customer packing list for this outbound shipment."
      buttonLabel="Print packing slip"
    >
      <article className="grid gap-4 text-sm text-black">
        <DocumentHeader
          eyebrow="Packing slip"
          title={doc.shipmentNumber}
          barcodeValue={doc.shipmentNumber}
          fields={[
            { label: "Customer", value: doc.customer },
            { label: "Carrier", value: doc.carrier },
            { label: "Shipper", value: doc.shipperName },
            { label: "Shipped", value: formatDateTime(doc.shippedAt) },
            { label: "Pallets", value: String(doc.palletCount) },
            { label: "Units", value: String(doc.totalUnits) },
          ]}
        />
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 font-semibold">SKU</th>
              <th className="py-1 font-semibold">UPC</th>
              <th className="py-1 font-semibold">Description</th>
              <th className="py-1 font-semibold">Batch</th>
              <th className="py-1 font-semibold">From</th>
              <th className="py-1 text-right font-semibold">Qty</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.length === 0 ? (
              <tr>
                <td className="py-3 text-neutral-600" colSpan={6}>
                  No packed lines on this shipment.
                </td>
              </tr>
            ) : (
              doc.lines.map((line) => (
                <tr key={line.caseId} className="border-b border-neutral-300">
                  <td className="py-1.5 font-medium">{line.sku}</td>
                  <td className="py-1.5">{line.upc}</td>
                  <td className="py-1.5">{line.description}</td>
                  <td className="py-1.5">{line.batch || "—"}</td>
                  <td className="py-1.5">{line.fromLocation}</td>
                  <td className="py-1.5 text-right">{line.quantity}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="text-xs">
          {doc.totalLines} line{doc.totalLines === 1 ? "" : "s"} · {doc.skuCount}{" "}
          SKU{doc.skuCount === 1 ? "" : "s"} · {doc.totalUnits} unit
          {doc.totalUnits === 1 ? "" : "s"}
          {doc.notes ? ` · ${doc.notes}` : ""}
        </p>
        <SignatureRow labels={["Packed by", "Received by / date"]} />
      </article>
    </PrintDocument>
  );
}

export function LoadManifestSheet({ doc }: { doc: LoadManifestDocument }) {
  return (
    <PrintDocument
      id={`load-manifest-${doc.shipmentId}`}
      title="Load manifest"
      description="Print a dock manifest of pallets and units going on this load."
      buttonLabel="Print load manifest"
    >
      <article className="grid gap-4 text-sm text-black">
        <DocumentHeader
          eyebrow="Load manifest"
          title={doc.shipmentNumber}
          barcodeValue={doc.shipmentNumber}
          fields={[
            { label: "Customer", value: doc.customer },
            { label: "Carrier", value: doc.carrier },
            { label: "Shipper", value: doc.shipperName },
            { label: "Shipped", value: formatDateTime(doc.shippedAt) },
            { label: "Pallets", value: String(doc.totals.pallets) },
            { label: "Cases", value: String(doc.totals.cases) },
            { label: "SKUs", value: String(doc.totals.skus) },
            { label: "Units", value: String(doc.totals.units) },
          ]}
        />
        {doc.pallets.map((pallet) => (
          <section key={pallet.palletNumber} className="break-inside-avoid">
            <h3 className="font-heading text-sm font-semibold">
              Pallet {pallet.palletNumber}
              <span className="ml-2 font-sans text-xs font-normal text-neutral-600">
                {pallet.caseCount} case{pallet.caseCount === 1 ? "" : "s"} ·{" "}
                {pallet.unitCount} unit{pallet.unitCount === 1 ? "" : "s"}
              </span>
            </h3>
            <table className="mt-1 w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-black text-left">
                  <th className="py-1 font-semibold">SKU</th>
                  <th className="py-1 font-semibold">Description</th>
                  <th className="py-1 font-semibold">From</th>
                  <th className="py-1 text-right font-semibold">Qty</th>
                </tr>
              </thead>
              <tbody>
                {pallet.lines.map((line) => (
                  <tr key={line.caseId} className="border-b border-neutral-300">
                    <td className="py-1.5 font-medium">{line.sku}</td>
                    <td className="py-1.5">{line.description}</td>
                    <td className="py-1.5">{line.fromLocation}</td>
                    <td className="py-1.5 text-right">{line.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {doc.notes ? <p className="text-xs">Notes: {doc.notes}</p> : null}
        <SignatureRow labels={["Dock associate", "Driver / carrier"]} />
      </article>
    </PrintDocument>
  );
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Camera01Icon,
  Delete02Icon,
  Image01Icon,
} from "@hugeicons/core-free-icons";
import type { PhotoAttachment, PhotoOwnerType } from "@/lib/inventory-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LIMITS } from "@/lib/validation/limits";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  deleteProofPhoto,
  photoSrc,
  uploadProofPhoto,
} from "@/frontend/client/photo-api";

export type PhotoDraft = {
  id: string;
  file: File;
  previewUrl: string;
};

export function createPhotoDrafts(fileList: FileList | File[]): PhotoDraft[] {
  return Array.from(fileList).map((file) => ({
    id: crypto.randomUUID(),
    file,
    previewUrl: URL.createObjectURL(file),
  }));
}

export function revokePhotoDrafts(drafts: PhotoDraft[]) {
  for (const draft of drafts) {
    URL.revokeObjectURL(draft.previewUrl);
  }
}

function PhotoAddControls({
  disabled,
  remaining,
  onFiles,
}: {
  disabled?: boolean;
  remaining: number;
  onFiles: (files: FileList) => void;
}) {
  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={libraryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        multiple
        className="sr-only"
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={disabled || remaining <= 0}
        onClick={() => libraryRef.current?.click()}
      >
        <HugeiconsIcon icon={Image01Icon} strokeWidth={2} data-icon="inline-start" />
        Add photos
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || remaining <= 0}
        onClick={() => cameraRef.current?.click()}
      >
        <HugeiconsIcon icon={Camera01Icon} strokeWidth={2} data-icon="inline-start" />
        Take photo
      </Button>
    </div>
  );
}

function PhotoLightbox({
  photo,
  onClose,
}: {
  photo: PhotoAttachment;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="grid max-h-full max-w-3xl gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoSrc(photo.id)}
          alt={photo.caption || photo.originalName}
          className="max-h-[min(80dvh,40rem)] w-full rounded-md object-contain"
        />
        <p className="text-sm text-white">
          {photo.caption || photo.originalName} · {formatDateTime(photo.createdAt)}
          {photo.createdBy ? ` · ${photo.createdBy}` : ""}
        </p>
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

export function PhotoThumbnails({
  photos,
  className,
  ownerType,
  ownerId,
  canEdit = false,
}: {
  photos: PhotoAttachment[];
  className?: string;
  ownerType?: PhotoOwnerType;
  ownerId?: string;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const addRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<PhotoAttachment | null>(null);
  const [pending, setPending] = useState(false);
  const remaining = LIMITS.photoMaxCount - photos.length;
  const canAdd = Boolean(canEdit && ownerType && ownerId && remaining > 0);

  async function addFiles(fileList: FileList) {
    if (!ownerType || !ownerId) return;
    setPending(true);
    try {
      for (const file of Array.from(fileList).slice(0, remaining)) {
        const result = await uploadProofPhoto({ ownerType, ownerId, file });
        if (!result.ok) return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (photos.length === 0 && !canAdd) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {photos.map((photo) => (
        <button
          key={photo.id}
          type="button"
          className="size-10 overflow-hidden rounded-sm border border-border"
          onClick={() => setActive(photo)}
          title={photo.caption || photo.originalName}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoSrc(photo.id)}
            alt={photo.caption || photo.originalName}
            className="size-full object-cover"
          />
        </button>
      ))}
      {canAdd ? (
        <>
          <input
            ref={addRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            multiple
            className="sr-only"
            onChange={(event) => {
              if (event.target.files?.length) void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            disabled={pending}
            onClick={() => addRef.current?.click()}
          >
            <HugeiconsIcon icon={Image01Icon} strokeWidth={2} />
            <span className="sr-only">Add proof photo</span>
          </Button>
        </>
      ) : null}
      {active ? (
        <PhotoLightbox photo={active} onClose={() => setActive(null)} />
      ) : null}
    </div>
  );
}

export function PhotoDraftCollector({
  drafts,
  onChange,
  disabled,
  title = "Proof photos",
  description,
}: {
  drafts: PhotoDraft[];
  onChange: (drafts: PhotoDraft[]) => void;
  disabled?: boolean;
  title?: string;
  description?: string;
}) {
  const remaining = LIMITS.photoMaxCount - drafts.length;

  function addFiles(fileList: FileList) {
    const incoming = createPhotoDrafts(
      Array.from(fileList).slice(0, Math.max(0, remaining)),
    );
    onChange([...drafts, ...incoming]);
  }

  function remove(id: string) {
    const next = drafts.filter((draft) => draft.id !== id);
    const removed = drafts.find((draft) => draft.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    onChange(next);
  }

  return (
    <div className="grid gap-2 print:hidden">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <PhotoAddControls
        disabled={disabled}
        remaining={remaining}
        onFiles={addFiles}
      />
      {drafts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No photos yet. Add packing, pallet, or damage photos for this
          transaction.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {drafts.map((draft) => (
            <li
              key={draft.id}
              className="relative overflow-hidden rounded-md border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={draft.previewUrl}
                alt={draft.file.name}
                className="aspect-square w-full object-cover"
              />
              <Button
                type="button"
                size="icon-xs"
                variant="destructive"
                className="absolute top-1 right-1"
                onClick={() => remove(draft.id)}
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                <span className="sr-only">Remove {draft.file.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PhotoProofCollector({
  ownerType,
  ownerId,
  photos,
  canEdit = true,
  title,
  description,
}: {
  ownerType: PhotoOwnerType;
  ownerId: string;
  photos: PhotoAttachment[];
  canEdit?: boolean;
  title: string;
  description?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [active, setActive] = useState<PhotoAttachment | null>(null);
  const remaining = LIMITS.photoMaxCount - photos.length;

  async function addFiles(fileList: FileList) {
    setError(null);
    setPending(true);
    try {
      const files = Array.from(fileList).slice(0, Math.max(0, remaining));
      for (const file of files) {
        const result = await uploadProofPhoto({
          ownerType,
          ownerId,
          file,
          caption: caption.trim() || undefined,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
      }
      setCaption("");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to upload photos.",
      );
    } finally {
      setPending(false);
    }
  }

  async function remove(photoId: string) {
    setError(null);
    setPending(true);
    try {
      const result = await deleteProofPhoto(photoId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-3">
        {canEdit ? (
          <>
            <FieldCaption
              value={caption}
              onChange={setCaption}
              disabled={pending}
            />
            <PhotoAddControls
              disabled={pending}
              remaining={remaining}
              onFiles={addFiles}
            />
          </>
        ) : null}
        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No proof photos attached yet.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((photo) => (
              <li
                key={photo.id}
                className="grid gap-1 overflow-hidden rounded-md border border-border"
              >
                <button
                  type="button"
                  className="aspect-square overflow-hidden"
                  onClick={() => setActive(photo)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoSrc(photo.id)}
                    alt={photo.caption || photo.originalName}
                    className="size-full object-cover"
                  />
                </button>
                <div className="flex items-start justify-between gap-1 px-2 pb-2">
                  <p className="min-w-0 truncate text-[0.65rem] text-muted-foreground">
                    {photo.caption || photo.originalName}
                  </p>
                  {canEdit ? (
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => void remove(photo.id)}
                    >
                      <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                      <span className="sr-only">Remove photo</span>
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {active ? (
          <PhotoLightbox photo={active} onClose={() => setActive(null)} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function FieldCaption({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Input
      value={value}
      disabled={disabled}
      maxLength={LIMITS.notes}
      placeholder="Optional caption for the next photo (BOL, pallet, damage…)"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

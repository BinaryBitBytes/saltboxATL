"use client";

import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Allow camera access to take a photo.";
    }
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
      return "No camera is available in this browser.";
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "The camera could not be opened.";
}

export async function openCameraStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot open the camera.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "NotAllowedError" || error.name === "SecurityError")
    ) {
      throw error;
    }
    return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }
}

function streamEnded(stream: MediaStream): boolean {
  const tracks = stream.getVideoTracks();
  return tracks.length === 0 || tracks.every((track) => track.readyState === "ended");
}

async function captureFrame(video: HTMLVideoElement): Promise<File> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width === 0 || height === 0) {
    throw new Error("The camera is not ready yet.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to capture that photo.");
  }
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.9);
  });
  if (!blob) {
    throw new Error("Unable to capture that photo.");
  }
  return new File([blob], `camera-${Date.now()}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

export function ProofCamera({
  stream,
  onCapture,
  onClose,
}: {
  stream: Promise<MediaStream>;
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ownerRef = useRef<object | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    const generation = {};
    ownerRef.current = generation;
    let active = true;
    let current: MediaStream | null = null;

    async function attach(media: MediaStream) {
      const video = videoRef.current;
      if (!video) return;
      video.muted = true;
      video.srcObject = media;
      await video.play();
      if (!active || video.videoWidth === 0) return;
      setReady(true);
    }

    function releaseIfOwned(media: MediaStream) {
      if (ownerRef.current === generation) stopStream(media);
    }

    async function start() {
      try {
        let media = await stream;
        if (!active) {
          releaseIfOwned(media);
          return;
        }
        if (streamEnded(media)) {
          media = await openCameraStream();
        }
        if (!active) {
          releaseIfOwned(media);
          return;
        }
        current = media;
        await attach(media);
      } catch (caught) {
        if (active) setError(cameraErrorMessage(caught));
      }
    }

    void start();
    return () => {
      active = false;
      const owned = current;
      queueMicrotask(() => {
        if (ownerRef.current === generation && owned) stopStream(owned);
      });
    };
  }, [stream]);

  async function capture() {
    const video = videoRef.current;
    if (!video) return;
    setCapturing(true);
    try {
      onCapture(await captureFrame(video));
    } catch (caught) {
      setError(cameraErrorMessage(caught));
      setCapturing(false);
    }
  }

  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label="Camera preview"
        onLoadedMetadata={(event) => {
          if (event.currentTarget.videoWidth > 0) setReady(true);
        }}
        className={cn(
          "max-h-[min(20rem,50dvh)] min-h-32 w-full rounded-md bg-black object-contain short:min-h-24",
          error && "hidden",
        )}
      />
      {error ? (
        <div className="grid gap-2">
          <p className="text-xs text-destructive">{error}</p>
          <label className={cn(buttonVariants({ variant: "outline" }), "relative w-fit")}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Open the camera"
              className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onCapture(file);
              }}
            />
            Open the camera
          </label>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Point the camera at the freight or document, then capture the photo.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!ready || capturing || Boolean(error)}
          onClick={() => void capture()}
        >
          {capturing ? "Saving…" : "Capture photo"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Close camera
        </Button>
      </div>
    </div>
  );
}

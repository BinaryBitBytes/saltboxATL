"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon, SmartPhone01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    ("standalone" in navigator &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

function isIosDevice(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !("MSStream" in window)
  );
}

export function usePwaInstall() {
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setStandalone(isStandaloneDisplay());
    setIos(isIosDevice());

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setPromptEvent(null);
      setStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice;
    setPromptEvent(null);
  }

  return { standalone, ios, canPrompt: Boolean(promptEvent), install };
}

export function InstallAppButton() {
  const { standalone, canPrompt, install } = usePwaInstall();
  if (standalone || !canPrompt) return null;

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void install()}>
      <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
      Install app
    </Button>
  );
}

export function InstallAppCard() {
  const { standalone, ios, canPrompt, install } = usePwaInstall();
  if (standalone) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HugeiconsIcon icon={SmartPhone01Icon} strokeWidth={2} className="size-4" />
          Install on this device
        </CardTitle>
        <CardDescription>
          Add Saltbox to a phone home screen or desktop so receiving and shipping
          open like a local app.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {canPrompt ? (
          <Button type="button" onClick={() => void install()}>
            <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
            Install Saltbox
          </Button>
        ) : ios ? (
          <p className="text-sm text-muted-foreground">
            On iPhone or iPad, tap Share, then Add to Home Screen.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            In Chrome, Edge, or Safari, use Install app, Add to Dock, or Add to
            Home Screen from the browser menu.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

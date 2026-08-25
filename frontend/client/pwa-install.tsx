"use client";

import { useSyncExternalStore } from "react";
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
import {
  isIosDevice,
  isStandaloneDisplay,
  shouldShowInstallHelp,
} from "@/lib/pwa/display";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const emptySubscribe = () => () => undefined;

let promptEvent: BeforeInstallPromptEvent | null = null;
let listening = false;
const promptListeners = new Set<() => void>();

function emitPrompt() {
  for (const listener of promptListeners) listener();
}

function onBeforeInstallPrompt(event: Event) {
  event.preventDefault();
  promptEvent = event as BeforeInstallPromptEvent;
  emitPrompt();
}

function onAppInstalled() {
  promptEvent = null;
  emitPrompt();
}

function ensurePromptListeners() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
}

function subscribePrompt(onStoreChange: () => void) {
  ensurePromptListeners();
  promptListeners.add(onStoreChange);
  return () => {
    promptListeners.delete(onStoreChange);
  };
}

function getPromptSnapshot() {
  return promptEvent;
}

function subscribeStandalone(onStoreChange: () => void) {
  const standaloneQuery = window.matchMedia("(display-mode: standalone)");
  const overlayQuery = window.matchMedia("(display-mode: window-controls-overlay)");
  standaloneQuery.addEventListener("change", onStoreChange);
  overlayQuery.addEventListener("change", onStoreChange);
  window.addEventListener("appinstalled", onStoreChange);
  return () => {
    standaloneQuery.removeEventListener("change", onStoreChange);
    overlayQuery.removeEventListener("change", onStoreChange);
    window.removeEventListener("appinstalled", onStoreChange);
  };
}

function useClientReady() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export function usePwaInstall() {
  const ready = useClientReady();
  const standalone = useSyncExternalStore(
    subscribeStandalone,
    () => isStandaloneDisplay(window),
    () => true,
  );
  const ios = useSyncExternalStore(
    emptySubscribe,
    () => isIosDevice(window),
    () => false,
  );
  const deferredPrompt = useSyncExternalStore(
    subscribePrompt,
    getPromptSnapshot,
    () => null,
  );

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    promptEvent = null;
    emitPrompt();
  }

  return {
    ready,
    standalone,
    ios,
    canPrompt: Boolean(deferredPrompt),
    showHelp: shouldShowInstallHelp(ready, standalone),
    install,
  };
}

export function InstallAppButton() {
  const { showHelp, canPrompt, install } = usePwaInstall();
  if (!showHelp || !canPrompt) return null;

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void install()}>
      <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
      Install app
    </Button>
  );
}

export function InstallAppCard() {
  const { showHelp, ios, canPrompt, install } = usePwaInstall();
  if (!showHelp) return null;

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

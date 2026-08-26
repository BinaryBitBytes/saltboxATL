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
const INSTALLED_KEY = "saltbox-pwa-installed";

let promptEvent: BeforeInstallPromptEvent | null = null;
let installedThisSession = false;
let listening = false;
const promptListeners = new Set<() => void>();
const standaloneListeners = new Set<() => void>();

function emitAll() {
  for (const listener of promptListeners) listener();
  for (const listener of standaloneListeners) listener();
}

function hasInstalledThisSession() {
  if (installedThisSession) return true;
  try {
    return sessionStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

function markInstalled() {
  installedThisSession = true;
  try {
    sessionStorage.setItem(INSTALLED_KEY, "1");
  } catch {
    // Ignore private-mode storage failures; in-memory flag still hides the UI.
  }
  promptEvent = null;
  emitAll();
}

function onBeforeInstallPrompt(event: Event) {
  event.preventDefault();
  promptEvent = event as BeforeInstallPromptEvent;
  emitAll();
}

function ensureInstallListeners() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  installedThisSession = hasInstalledThisSession();
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", markInstalled);
}

function subscribePrompt(onStoreChange: () => void) {
  ensureInstallListeners();
  promptListeners.add(onStoreChange);
  return () => {
    promptListeners.delete(onStoreChange);
  };
}

function getPromptSnapshot() {
  return promptEvent;
}

function subscribeStandalone(onStoreChange: () => void) {
  ensureInstallListeners();
  const standaloneQuery = window.matchMedia("(display-mode: standalone)");
  const overlayQuery = window.matchMedia("(display-mode: window-controls-overlay)");
  standaloneQuery.addEventListener("change", onStoreChange);
  overlayQuery.addEventListener("change", onStoreChange);
  standaloneListeners.add(onStoreChange);
  return () => {
    standaloneQuery.removeEventListener("change", onStoreChange);
    overlayQuery.removeEventListener("change", onStoreChange);
    standaloneListeners.delete(onStoreChange);
  };
}

function subscribeInstalled(onStoreChange: () => void) {
  ensureInstallListeners();
  standaloneListeners.add(onStoreChange);
  return () => {
    standaloneListeners.delete(onStoreChange);
  };
}

function getStandaloneSnapshot() {
  return isStandaloneDisplay(window);
}

function getInstalledSnapshot() {
  return hasInstalledThisSession();
}

function useClientReady() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export function usePwaInstall() {
  const ready = useClientReady();
  const standalone = useSyncExternalStore(
    subscribeStandalone,
    getStandaloneSnapshot,
    () => true,
  );
  const installedThisSession = useSyncExternalStore(
    subscribeInstalled,
    getInstalledSnapshot,
    () => false,
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
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      markInstalled();
      return;
    }
    promptEvent = null;
    emitAll();
  }

  return {
    ready,
    standalone,
    ios,
    canPrompt: Boolean(deferredPrompt),
    showHelp: shouldShowInstallHelp(ready, standalone, installedThisSession),
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

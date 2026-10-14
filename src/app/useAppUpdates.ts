import { useEffect, useRef, useState } from "react";
import { apiJson } from "./api";
import { useThisComputer } from "./device";
import { showToastTone as showToast } from "./toast";
import type { UpdatePrefs, UpdateStatus } from "./types";
import type { ConfirmAction } from "./useConfirmation";

const updateInstalledKey = "heiss-ui:update-installed";
const formatUpdateBytes = (bytes = 0) => `${(bytes / 1024 ** 2).toFixed(bytes > 100 * 1024 ** 2 ? 0 : 1)} MB`;

export function useAppUpdates(confirmAction: ConfirmAction) {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // The version this page just came back on after an update, for the "Updated" pill.
  const [justUpdated, setJustUpdated] = useState("");
  // After "Install update" the server has to restart; once this page sees a server
  // that started after the install, say the update landed (or that it was undone).
  useEffect(() => {
    let pending: { at: number } | null = null;
    try { pending = JSON.parse(localStorage.getItem(updateInstalledKey) || "null"); } catch { pending = null; }
    if (!pending?.at) return;
    fetch("/api/health").then((response) => response.json()).then(async (data: { startedAt?: number }) => {
      if (!data?.startedAt || data.startedAt < pending!.at) return;
      try { localStorage.removeItem(updateInstalledKey); } catch { /* nothing to clear */ }
      const status = await apiJson<UpdateStatus>("/api/update/status").catch(() => null);
      if (status) setUpdateStatus(status);
      const result = status?.result;
      if (result && !result.ok) showToast(result.rolledBack ? `HEISS UI ${result.to} didn’t start. Back on ${result.from}${result.error ? ` (${result.error})` : ""}.` : result.error || "The update didn’t install", "error");
      else if (status?.release) setJustUpdated(result?.to || status.current || "");
      else showToast("HEISS UI updated", "success");
    }).catch(() => null);
  }, []);

  // A release download runs on the server; follow it while it is in flight.
  const downloadStage = updateStatus?.download?.status;
  useEffect(() => {
    if (downloadStage !== "downloading" && downloadStage !== "verifying" && downloadStage !== "unpacking") return;
    const timer = window.setInterval(() => {
      // The update pill (or Settings › About) shows how it ends.
      apiJson<UpdateStatus>("/api/update/status").then(setUpdateStatus).catch(() => null);
    }, 800);
    return () => window.clearInterval(timer);
  }, [downloadStage]);

  // Looks for a new release on its own, on the computer that can install it:
  // shortly after opening, then every six hours while the page is open (the
  // server keeps GitHub's answer, so every device and tab share one ask). It
  // stays silent when offline or switched off in Settings › About.
  // Not tied to ComfyUI: the address says "this computer" before /api/health
  // does, and the server refuses anyone else anyway.
  const canManage = useThisComputer();
  const lastUpdateCheck = useRef(0);
  const refreshUpdateStatus = () => {
    lastUpdateCheck.current = Date.now();
    fetch("/api/update/status?auto=1", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<UpdateStatus> : null)
      // Only a release copy has an answer here; a checkout keeps what About found.
      .then((data) => { if (data?.ok && data.release) setUpdateStatus(data); })
      .catch(() => null);
  };
  useEffect(() => {
    if (!canManage) return;
    const check = () => {
      if (document.hidden || Date.now() - lastUpdateCheck.current < 6 * 60 * 60 * 1000) return;
      refreshUpdateStatus();
    };
    // The server asked GitHub when it started, so this is usually instant.
    const first = window.setTimeout(check, 1500);
    const timer = window.setInterval(check, 30 * 60 * 1000);
    document.addEventListener("visibilitychange", check);
    return () => { window.clearTimeout(first); window.clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, [canManage]);

  /** "Later" on the update pill, or the automatic-check switch: shared by every device. */
  async function setUpdatePrefs(next: Partial<UpdatePrefs>) {
    setUpdateStatus((current) => current?.prefs ? { ...current, prefs: { ...current.prefs, ...next } } : current);
    try {
      const data = await apiJson<{ prefs: UpdatePrefs }>("/api/update/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      setUpdateStatus((current) => current ? { ...current, prefs: data.prefs } : current);
      // Switched back on: look now rather than in six hours.
      if (next.autoCheck) apiJson<UpdateStatus>("/api/update/status?auto=1").then((status) => { if (status.ok && status.release) setUpdateStatus(status); }).catch(() => null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t save that", "error");
    }
  }

  async function checkForUpdates(notify = true) {
    try {
      setUpdateBusy(true);
      // The check the person asks for always goes to GitHub; polling uses the server's cache.
      const data = await apiJson<UpdateStatus>("/api/update/status?fresh=1");
      setUpdateStatus(data);
      if (notify) showToast(data.available ? "Update available" : data.ok ? "Up to date" : data.error || "Couldn’t check for updates", data.ok ? "success" : "error");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn’t check for updates";
      setUpdateStatus({ ok: false, error: message });
      if (notify) showToast(message, "error");
    } finally {
      setUpdateBusy(false);
    }
  }

  async function installUpdate({ confirm = true }: { confirm?: boolean } = {}) {
    const release = Boolean(updateStatus?.release);
    if (confirm && !await confirmAction(release
      ? { title: `Update to HEISS UI ${updateStatus?.latest}?`, description: `Downloads${updateStatus?.size ? ` ${formatUpdateBytes(updateStatus.size)}` : " the update"} and installs it when HEISS UI restarts.`, action: "Download" }
      : { title: "Update HEISS UI?", description: "Pulls the latest code, installs packages and rebuilds.", action: "Update" })) return;
    try {
      setUpdateBusy(true);
      const data = await apiJson<UpdateStatus>("/api/update/install", { method: "POST" });
      setUpdateStatus(data);
      if (release) {
        if (data.message) showToast(data.message, "default");
        return;
      }
      if (data.updated) {
        try { localStorage.setItem(updateInstalledKey, JSON.stringify({ at: Date.now() })); } catch { /* the success toast just won't show */ }
      }
      showToast(data.updated ? "Update installed. Restart HEISS UI to use it." : data.message || "Up to date", data.updated ? "success" : "default");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t update", "error", { action: { label: "Try again", onClick: () => installUpdate({ confirm: false }) } });
    } finally {
      setUpdateBusy(false);
    }
  }

  /**
   * Restarts HEISS UI through its launcher (which also swaps in a downloaded
   * update), then reloads the page once the new server answers.
   */
  async function restartHeiss({ update = false } = {}) {
    const at = Date.now();
    try {
      await apiJson("/api/update/restart", { method: "POST" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t restart HEISS UI", "error", { action: { label: "Try again", onClick: () => restartHeiss({ update }) } });
      return false;
    }
    // A downloaded update goes in with any restart, so say so when the page comes back.
    if (update || updateStatus?.download?.status === "ready") {
      try { localStorage.setItem(updateInstalledKey, JSON.stringify({ at })); } catch { /* the toast just won't show */ }
    }
    setRestarting(true);
    // Wait for a server that started after the restart, then load its new page.
    const deadline = at + 3 * 60 * 1000;
    const poll = async () => {
      const data = await fetch("/api/health", { cache: "no-store" }).then((response) => response.json()).catch(() => null);
      if (data?.startedAt && data.startedAt >= at) { window.location.reload(); return; }
      if (Date.now() > deadline) {
        setRestarting(false);
        showToast("HEISS UI didn’t come back. Start it again with its launcher.", "error", { duration: Infinity, action: { label: "Reload", onClick: () => window.location.reload() } });
        return;
      }
      window.setTimeout(poll, 1000);
    };
    window.setTimeout(poll, 1500);
    return true;
  }
  const restartForUpdate = () => restartHeiss({ update: true });

  return { updateStatus, updateBusy, restarting, justUpdated, setJustUpdated, refreshUpdateStatus, setUpdatePrefs, checkForUpdates, installUpdate, restartHeiss, restartForUpdate };
}

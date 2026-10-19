import { canAdmin, clientOf, deviceSession } from './access.js';
import { encryptionKeyFromRequest } from './privacy.js';
import { multiUserEnabled } from './multi-user-auth.js';

/** This computer, or another device that signed in (the gate below has already checked). */
export function requireLocal(req, res) {
  if (multiUserEnabled) {
    if (canAdmin(req)) return true;
    res.status(403).json({ ok: false, error: "This action is restricted to administrators." });
    return false;
  }
  const client = clientOf(req);
  if (client.thisComputer || (client.network && deviceSession(req))) return true;
  res.status(403).json({ ok: false, error: "Only this computer or a signed-in device can do this." });
  return false;
}

/**
 * Looking after the computer (model folders and downloads, node installs,
 * ComfyUI's address and restarts, the output folder, updates, workflow files,
 * clearing the gallery) happens at that computer. A signed-in device may too
 * when the owner turned on "Trust other devices with admin" (access.js).
 * Anywhere else the server refuses them and the app hides them.
 */
export function requireAdmin(req, res) {
  if (canAdmin(req)) return true;
  res.status(403).json({ ok: false, reason: "computer-only", error: "Do this on the computer running Studio. Other devices can be allowed in Settings › Connection." });
  return false;
}

/** Creating, erasing or re-keying Hidden happens at the computer it runs on, never from the network. */
export function requireThisComputer(req, res) {
  if (multiUserEnabled) {
    if (clientOf(req).thisComputer && canAdmin(req)) return true;
    res.status(403).json({ ok: false, reason: "this-computer", error: "Only an administrator on the computer running Studio can do this." });
    return false;
  }
  if (clientOf(req).thisComputer) return true;
  res.status(403).json({ ok: false, reason: "this-computer", error: "Only the computer running Studio can do this." });
  return false;
}

export function requireHiddenKey(req, res) {
  const key = encryptionKeyFromRequest(req);
  if (!key) res.status(401).json({ ok: false, locked: true, error: "Hidden is locked." });
  return key;
}

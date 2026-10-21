import { Group, Row, Status } from './SettingsControls';
import type { UpscaleInstall, UpscaleStatus } from './types';
import { formatBytes } from './useUpscale';

/** Where Upscale stands, in words: read only, as its weights and nodes are the worker's business. */
export function upscaleReadiness(status: UpscaleStatus | null, reason: string | undefined, install: UpscaleInstall): { tone: 'ok' | 'warn' | 'bad'; label: string; detail: string } {
  if (install?.status === 'running') return { tone: 'warn', label: 'Downloading', detail: `${formatBytes(install.receivedBytes)} of ${formatBytes(install.totalBytes)} of the upscale model.` };
  if (!status) return { tone: 'warn', label: 'Unavailable', detail: reason || 'Upscale isn’t available right now.' };
  if (!status.nodesInstalled) return { tone: 'warn', label: 'Not Set Up', detail: 'The worker needs the SeedVR2 nodes.' };
  if (install?.status === 'error' && !status.ready) return { tone: 'bad', label: 'Download Stopped', detail: install.error || 'The upscale model didn’t finish downloading.' };
  if (status.needsDownload) return { tone: 'warn', label: 'Not Set Up', detail: `The worker needs ${formatBytes(status.downloadBytes)} of SeedVR2 weights.` };
  if (status.substituting) return { tone: 'warn', label: 'Ready', detail: 'Upscales with a substitute model until its own is on the worker.' };
  return { tone: 'ok', label: 'Ready', detail: 'The upscale arrow sits on finished images.' };
}

/**
 * Settings › Workers › Upscale: whether the worker can upscale, as its own group
 * at the end of the page (the worker groups above it are separate components).
 */
export function UpscaleStatusGroup({ status, reason, install }: { status: UpscaleStatus | null; reason?: string; install: UpscaleInstall }) {
  const upscale = upscaleReadiness(status, reason, install);
  return <Group title="Upscale">
    <Row label="Upscale Status" description={upscale.detail}><Status tone={upscale.tone}>{upscale.label}</Status></Row>
  </Group>;
}

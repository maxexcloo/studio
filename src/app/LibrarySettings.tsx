import React from 'react';
import { loraName } from './catalogueNames';
import { loraRoleLabel } from './modelRecipes';
import type { LoraInfo } from './useLoraInfo';
import { apiJson } from './api';
import { Group, Row, SwitchRow } from './SettingsControls';
import { clearPrompts, setPromptHistoryEnabled, usePromptHistory } from './recentPrompts';
import type { ShowToast } from './toast';

/* ---------------------------------------------------------------------------
   Settings rows about what Studio keeps: recent prompts, and the LoRA and supporting-file inventory.
--------------------------------------------------------------------------- */

const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;

/** Recent prompts: whether to keep them, what the list holds, and the way to empty it. */
export function PromptHistoryRow({ showToast }: { showToast: ShowToast }) {
  const { prompts, enabled } = usePromptHistory(true);
  const starred = prompts.filter((entry) => entry.pinned).length;
  const recent = prompts.length - starred;
  const fail = (error: unknown) => showToast(error instanceof Error ? error.message : 'Couldn’t change recent prompts', 'error');
  const toggle = async (next: boolean) => {
    setPromptHistoryEnabled(next).catch(fail);
  };
  return (
    <>
      <SwitchRow
        label="Keep Recent Prompts"
        description={`Press ↑ in an empty prompt, or the clock beside Negative, to reuse one. Shared with other devices.${enabled && prompts.length ? ` ${plural(recent, 'recent prompt')}${starred ? `, ${starred} starred` : ''}.` : ''}`}
        checked={enabled}
        onChange={(next) => void toggle(next)}
      />
      {enabled && recent ? (
        <Row label="Forget Recent Prompts" description={starred ? 'Starred prompts stay.' : 'The list starts over with your next prompt.'}>
          <button className="btn" onClick={async () => {
            clearPrompts().catch(fail);
          }}>Forget</button>
        </Row>
      ) : null}
    </>
  );
}

/** Adapter inventory is read-only; generation effects are chosen in the composer. */
export function AdapterLibraryGroup() {
  const [infos, setInfos] = React.useState<Record<string, LoraInfo> | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let live = true;
    apiJson<{ loras?: Record<string, LoraInfo> }>('/api/loras/info').then((data) => { if (live) setInfos(data.loras || {}); }).catch(() => { if (live) setError('Couldn’t load the LoRA list.'); });
    return () => { live = false; };
  }, []);
  return <Group title="LoRAs & Supporting Files" note="Choose acceleration through a prepared recipe. Supporting files stay out of the optional LoRA picker.">
    {error ? <Row label="LoRAs Unavailable" description={error} /> : infos === null ? <Row label="Loading LoRAs…" /> : Object.entries(infos).sort(([a, left], [b, right]) => loraName(a, left).localeCompare(loraName(b, right))).map(([name, info]) => <Row key={name} label={loraName(name, info)} description={<>{info.role ? loraRoleLabel(info) : 'LoRA · Role Unknown'}{info.base ? ` · ${info.base}` : ''}<br /><code className="set-path">{name}</code>{info.note ? <><br />{info.note}</> : null}</>} />)}
    {infos && !Object.keys(infos).length ? <Row label="No LoRAs Yet" description="LoRAs and supporting files on the workers show here." /> : null}
  </Group>;
}

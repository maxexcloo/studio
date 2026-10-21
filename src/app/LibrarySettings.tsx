import { Row, SwitchRow } from './SettingsControls';
import { clearPrompts, setPromptHistoryEnabled, usePromptHistory } from './recentPrompts';
import type { ShowToast } from './toast';
import { plural } from './format';

/* ---------------------------------------------------------------------------
   Settings rows about what Studio keeps: recent prompts. The LoRA inventory is in Library › LoRAs.
--------------------------------------------------------------------------- */


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

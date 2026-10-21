import React from 'react';
import { ChevronDown, Trash2, X } from 'lucide-react';
import { loraName, modelFamilyLabel } from './catalogueNames';
import { cn } from './format';
import { allLoraStacks, deleteLoraStack, renameLoraStack, restoreLoraStack, subscribeLoraLibrary, updateLoraStack, type LoraSnapshot } from './lora-storage';
import { Group, Row, SaveRow } from './SettingsControls';
import { showToastTone } from './toast';
import { knownLoraInfo } from './useLoraInfo';
import type { LoraSelection } from './types';

type Entry = { key: string; stack: LoraSnapshot };

const familyOf = (key: string) => modelFamilyLabel({ family: key.replace(/^family:/, '') }) || 'Other Models';
const sameLoras = (a: LoraSelection[], b: LoraSelection[]) => a.length === b.length && a.every((item, index) => item.name === b[index].name && Math.abs(item.strength - b[index].strength) < 0.001 && item.enabled === b[index].enabled);

function useStacks() {
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => subscribeLoraLibrary(() => setRevision((value) => value + 1)), []);
  return React.useMemo(() => allLoraStacks().sort((a, b) => a.stack.name.localeCompare(b.stack.name, undefined, { sensitivity: 'base' }) || familyOf(a.key).localeCompare(familyOf(b.key))), [revision]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Settings › Studio › LoRA Stacks (UI-PATTERNS › Settings): every saved stack
 * of this account, alphabetically. A row opens its editor in place: the name,
 * each LoRA's strength and Remove, kept as a draft until Save & Discard;
 * Delete acts at once with Undo in the status pill.
 */
export function LoraStackSettings() {
  const stacks = useStacks();
  const [open, setOpen] = React.useState('');
  return (
    <Group title="LoRA Stacks" note={stacks.length ? undefined : 'Save a stack from the Stacks menu at the top of the LoRAs picker'}>
      {stacks.length ? stacks.map((entry) => (
        <StackRow key={`${entry.key}:${entry.stack.id}`} entry={entry} open={open === entry.stack.id} onToggle={() => setOpen((current) => current === entry.stack.id ? '' : entry.stack.id)} />
      )) : <Row label="No Saved Stacks" />}
    </Group>
  );
}

function StackRow({ entry, open, onToggle }: { entry: Entry; open: boolean; onToggle: () => void }) {
  const { key, stack } = entry;
  const info = knownLoraInfo();
  const [name, setName] = React.useState(stack.name);
  const [loras, setLoras] = React.useState(stack.loras);
  React.useEffect(() => { setName(stack.name); setLoras(stack.loras); }, [stack]);
  const dirty = name.trim() !== stack.name || !sameLoras(loras, stack.loras);
  const discard = () => { setName(stack.name); setLoras(stack.loras); };
  const save = () => {
    if (name.trim() && name.trim() !== stack.name) renameLoraStack(key, stack.id, name);
    if (!sameLoras(loras, stack.loras)) updateLoraStack(key, stack.id, loras);
    showToastTone('Stack saved', 'success');
  };
  const remove = () => {
    deleteLoraStack(key, stack.id);
    showToastTone(`Deleted ${stack.name}`, 'removed', { action: { label: 'Undo', onClick: () => restoreLoraStack(key, stack) } });
  };
  const editorId = React.useId();
  return (
    <div className={cn('lora-stack-setting', open && 'is-open')}>
      <button type="button" className="list-row set-row set-drawer-toggle" aria-expanded={open} aria-controls={editorId} onClick={onToggle}>
        <span className="list-row-text">
          <span className="list-row-label">{stack.name}</span>
          <span className="list-row-detail">{familyOf(key)} · {stack.loras.length} LoRA{stack.loras.length === 1 ? '' : 's'}</span>
        </span>
        <span className="set-drawer-knob" aria-hidden="true"><ChevronDown size={14} /></span>
      </button>
      {open ? (
        <div id={editorId} className="lora-stack-editor" role="group" aria-label={`Edit ${stack.name}`}>
          <Row label="Name">
            <input className="lora-stack-name" aria-label="Stack Name" value={name} onChange={(event) => setName(event.target.value)} />
          </Row>
          {loras.map((item, index) => {
            const label = loraName(item.name, info?.[item.name]);
            return (
              <Row key={item.name} label={label} description={item.enabled ? undefined : 'Off in this stack'}>
                <input className="lora-stack-strength" type="number" inputMode="decimal" step={0.05} min={-4} max={4} aria-label={`${label} Strength`} value={item.strength}
                  onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) setLoras((current) => current.map((entry, i) => i === index ? { ...entry, strength: Math.round(value * 100) / 100 } : entry)); }} />
                <button type="button" className="lora-stack-remove" aria-label={`Remove ${label} From ${stack.name}`} onClick={() => setLoras((current) => current.filter((_, i) => i !== index))}><X size={14} /></button>
              </Row>
            );
          })}
          {!loras.length ? <Row label="No LoRAs" description="Saving keeps an empty stack; Delete removes it" /> : null}
          <Row label="Delete Stack" description="Removes it from every LoRAs picker; you can undo">
            <button type="button" className="btn is-ghost lora-stack-delete" onClick={remove}><Trash2 size={14} /> Delete</button>
          </Row>
          <SaveRow dirty={dirty} canSave={Boolean(name.trim())} onSave={save} onDiscard={discard} />
        </div>
      ) : null}
    </div>
  );
}

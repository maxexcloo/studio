import React from 'react';
import { Video } from 'lucide-react';
import { apiJson, referenceAssetFromGallery } from './api';
import { clientJobUuid } from './format';
import { Modal } from './Modal';
import { SafeImg } from './SafeImg';
import type { GalleryItem, Profile } from './types';

export function canAnimatePhoto(item: GalleryItem) {
  return item.status === 'done' && item.type === 'image' && Boolean(item.url) && !item.vaultLocked && !item.library;
}

function animationPrompt(item: GalleryItem) {
  const source = (item.prompt || '').trim();
  const motion = [
    [/\b(ocean|sea|wave|river|waterfall|lake)\b/i, 'Water flows naturally with soft ripples and shifting reflections.'],
    [/\b(cat|dog|bird|animal|horse|fox|wolf)\b/i, 'The animal breathes gently, blinks and makes a small natural head movement.'],
    [/\b(person|woman|man|girl|boy|portrait|people)\b/i, 'The subject breathes gently, blinks and makes a subtle natural movement; hair and clothing move softly.'],
    [/\b(tree|forest|flower|garden|mountain|landscape)\b/i, 'A light breeze moves the foliage while clouds drift slowly across the scene.'],
    [/\b(city|street|building|neon)\b/i, 'Ambient light and reflections shift softly as the camera makes a slow cinematic push in.'],
  ].find(([pattern]) => (pattern as RegExp).test(source))?.[1] || 'Add subtle natural movement to the subject and a slow cinematic camera push in.';
  return `${source ? `${source}\n\n` : ''}${motion} Preserve the original composition, subject identity and visual style. Keep motion smooth and avoid cuts.`;
}

type AnimationDraft = { item: GalleryItem; prompt: string; clientJobId: string; queued: boolean; error: string };

export function AnimatePhotos({ items, profiles, autoResizeInputs, onClose }: {
  items: GalleryItem[];
  profiles: Profile[];
  autoResizeInputs: boolean;
  onClose: () => void;
}) {
  const available = profiles.filter((profile) => {
    const images = profile.mediaInputs?.filter((input) => input.kind === 'image') || [];
    const requiredCount = images.reduce((total, input) => total + (input.min ?? (input.required ? 1 : 0)), 0);
    return profile.kind === 'video' && profile.ready !== false && (profile.family || '').replaceAll('-', '_') === 'minimax_h3' && images.length > 0 && requiredCount <= 1 && !images.slice(1).some((input) => input.required || (input.min || 0) > 0);
  });
  const [profileId, setProfileId] = React.useState(available[0]?.id || '');
  const [drafts, setDrafts] = React.useState<AnimationDraft[]>(() => items.filter(canAnimatePhoto).map((item) => ({ item, prompt: animationPrompt(item), clientJobId: clientJobUuid(), queued: false, error: '' })));
  const [busy, setBusy] = React.useState(false);
  const posting = React.useRef(false);
  const profile = available.find((candidate) => candidate.id === profileId);
  const queued = drafts.filter((draft) => draft.queued).length;
  const remaining = drafts.filter((draft) => !draft.queued);
  const patch = (id: string, values: Partial<AnimationDraft>) => setDrafts((current) => current.map((draft) => draft.item.id === id ? { ...draft, ...values } : draft));

  async function submit() {
    if (!profile || posting.current || remaining.some((draft) => !draft.prompt.trim())) return;
    posting.current = true;
    setBusy(true);
    try {
      // The endpoint acknowledges a queued job immediately; never wait for rendering.
      for (const draft of remaining) {
        try {
          const asset = await referenceAssetFromGallery(draft.item.id);
          await apiJson('/api/generate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ...profile.defaults,
              autoResizeInputs,
              clientJobId: draft.clientJobId,
              count: 1,
              kind: 'video',
              model: profile.model,
              privateVault: Boolean(draft.item.privateVault),
              profileId: profile.id,
              prompt: draft.prompt.trim(),
              referenceAssets: [{ slot: profile.mediaInputs!.find((input) => input.kind === 'image')!.id, assetId: asset.id }],
              seed: '',
              workflow: profile.workflow,
            }),
          });
          patch(draft.item.id, { queued: true, error: '' });
        } catch (error) {
          patch(draft.item.id, { error: error instanceof Error ? error.message : 'Couldn’t queue this animation.' });
        }
      }
    } finally {
      posting.current = false;
      setBusy(false);
    }
  }

  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="Animate" icon={<Video size={20} />} busy={busy} className="animate-photos" description="Review the motion suggested from each photo’s saved prompt, then queue one MiniMax H3 video per photo." footer={<>
    <span role="status">{queued ? `${queued} of ${drafts.length} animations queued. Find them in Video.` : `${drafts.length} photos selected.`}</span>
    <button type="button" className="btn" disabled={busy} onClick={onClose}>{remaining.length ? 'Cancel' : 'Done'}</button>
    {remaining.length ? <button type="button" className="btn is-primary" disabled={busy || !profile || remaining.some((draft) => !draft.prompt.trim())} onClick={() => { void submit(); }}>{busy ? 'Queueing…' : queued || drafts.some((draft) => draft.error) ? `Retry ${remaining.length} Remaining` : `Queue ${remaining.length} Animations`}</button> : null}
  </>}>
    {available.length ? <label className="animation-model">Video Model<select disabled={busy || queued > 0} value={profileId} onChange={(event) => setProfileId(event.target.value)}>{available.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName || candidate.label}</option>)}</select></label> : <p role="status">No ready MiniMax H3 image-to-video model is available. Add its workflow and required model files, then rescan models.</p>}
    {drafts.map((draft, index) => <section className="animation-photo" key={draft.item.id}>
      <SafeImg src={draft.item.thumbnailUrl || draft.item.url} alt={`Photo ${index + 1}`} fallback={<span className="animation-photo-fallback" role="img" aria-label={`Photo ${index + 1} unavailable`}><Video size={24} /></span>} />
      <label>Animation Prompt {index + 1}<textarea disabled={busy || draft.queued} maxLength={profile?.constraints?.prompt?.max} rows={4} value={draft.prompt} onChange={(event) => patch(draft.item.id, { prompt: event.target.value })} /></label>
      {draft.queued ? <p role="status">Queued</p> : draft.error ? <p role="alert">{draft.error}</p> : null}
    </section>)}
  </Modal>;
}

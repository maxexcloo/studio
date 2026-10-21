import type { GalleryItem, Profile } from './types';
import { modelName } from './catalogueNames';
import { partName } from './partNames';

/**
 * The profile an output ran through, for its title and Details: by the id it
 * recorded, an id the profile lists as a former one (`formerIds`), or the same
 * id without an imported workflow's `custom:` mark or a retired deployment
 * prefix ("old-image-moss-base" finds "image-moss-base"). Null when none fits,
 * and the output's stored name stands in.
 */
export function itemProfile(item: GalleryItem | null | undefined, profiles: Profile[] = []): Profile | null {
  if (!item) return null;
  const settings = (item.settings || {}) as Record<string, unknown>;
  const recorded = [settings.profileId, settings.workflow, item.model].filter((value): value is string => typeof value === 'string' && Boolean(value));
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const former = new Map<string, Profile>();
  for (const profile of profiles) for (const id of (profile as Profile & { formerIds?: string[] }).formerIds || []) former.set(id, profile);
  for (const id of recorded) {
    const bare = id.replace(/^custom:/, '');
    const candidates = [id, bare, `custom:${bare}`];
    const unprefixed = bare.match(/^[a-z0-9]+-(.+)$/i)?.[1];
    if (unprefixed) candidates.push(unprefixed, `custom:${unprefixed}`);
    for (const candidate of candidates) {
      const hit = byId.get(candidate) || former.get(candidate);
      if (hit) return hit;
    }
  }
  return null;
}

/** The output's profile name: the profile's own, or the name it recorded when it ran. */
export function itemProfileName(item: GalleryItem | null | undefined, profiles: Profile[] = []) {
  const profile = itemProfile(item, profiles);
  if (profile) return profile.displayName || profile.label;
  const stored = (item?.settings as Record<string, unknown> | undefined)?.profileName;
  return typeof stored === 'string' ? stored : '';
}

/** The output's title as the viewer and a tile's caption show it: the profile's friendly name, else its model part. */
export function itemProfileTitle(item: GalleryItem | null | undefined, profiles: Profile[] = []) {
  const profile = itemProfile(item, profiles);
  const modelPart = (item?.settings as Record<string, unknown> | undefined)?.modelName;
  return (profile ? modelName(profile).name : itemProfileName(item, profiles)) || (modelPart ? partName(String(modelPart)) : '');
}

import { Search, Star, X } from 'lucide-react';
import { PickerTools, SelectedTick } from './PickerTools';
import { CatalogueFilters, catalogueViews } from './CatalogueFilters';
import { recipesFor } from './modelRecipes';
import { modelName } from './catalogueNames';
import { modelDetails, setupNote, useModelCatalogue } from './modelCatalogue';
import { cn } from './format';
import { LinkedSizeFields, MegapixelField, SizeTabs, sizeMenuModel, type SizeTier } from './SizeMenu';
import { MEGAPIXEL } from './sizing';
import { ListButton, ListItem, ListSection, ListSelect } from './SheetList';
import { EmptyState } from './EmptyState';
import type { Profile } from './types';
import type { StudioViewModel } from './useStudio';

/* The pop-ups over the phone's Create sheet: Model and Size (PhoneCreate.tsx). */

type ModelListView = Pick<StudioViewModel, 'modelProfiles' | 'model' | 'pickModel' | 'modelMenu' | 'comfyStatus'>;

/** The model chooser's list (UI-PATTERNS › Pickers): search, Fast | Quality, favourites and family groups. */
export function PhoneModelList({ view, onPicked }: { view: ModelListView; onPicked: () => void }) {
  const { modelProfiles, model, pickModel, modelMenu } = view;
  const { profiles, menu, isFavourite, query, setQuery, filters, setFilters, sections, noMatchText } = useModelCatalogue(modelProfiles, model, modelMenu);
  const recipes = recipesFor(modelProfiles || [], model);
  const row = (profile: Profile) => (
    <div key={profile.id} className={cn('list-row model-pop-row', profile.id === model && 'is-selected')}>
      <button type="button" className="model-pop-pick" aria-current={profile.id === model || undefined} onClick={() => { pickModel(profile.id); onPicked(); }}>
        <span className="model-pop-name">{modelName(profile).name}<small className={cn(setupNote(profile) && 'is-setup')}>{[modelDetails(profile), setupNote(profile)].filter(Boolean).join(' · ')}</small></span>
        <SelectedTick on={profile.id === model} className="list-row-end" />
      </button>
      {menu ? (
        <button type="button" className={cn('picker-star', isFavourite(profile.id) && 'is-on')} aria-pressed={isFavourite(profile.id)} aria-label={isFavourite(profile.id) ? 'Remove from Favourites' : 'Add to Favourites'} onClick={() => menu.toggleFavorite(profile.id)}>
          <Star size={16} fill={isFavourite(profile.id) ? 'currentColor' : 'none'} />
        </button>
      ) : null}
    </div>
  );
  return (
    <>
      <div className="phone-model-tools">
        {recipes.length ? <ListItem label="Recipe"><ListSelect label="Recipe" value={model} options={recipes.map((profile) => ({ value: profile.id, label: profile.recipe!.label }))} onChange={(value) => pickModel(value)} /></ListItem> : null}
        {profiles.length ? <PickerTools query={query} onClearSearch={() => setQuery('')} searchLabel="Search Models" views={catalogueViews(filters, setFilters)} search={<label className="picker-search">
            <Search size={16} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Models" aria-label="Search Models" spellCheck={false} autoComplete="off" />
            {query ? <button type="button" aria-label="Clear Model Search" onClick={() => setQuery('')}><X size={14} /></button> : null}
          </label>}>
          <CatalogueFilters value={filters} onChange={setFilters} />
        </PickerTools> : null}
      </div>
      {!profiles.length ? (view.comfyStatus?.connected ? <EmptyState title="No Models Yet">Add a model to ComfyUI to see it here.</EmptyState> : <EmptyState title="ComfyUI Is Offline">Models show up when it’s back.</EmptyState>) : null}
      {sections.map((section) => <ListSection key={section.id} title={section.label || undefined}>{section.rows.map(row)}</ListSection>)}
      {profiles.length && !sections.length ? <EmptyState title="No Matching Models">{noMatchText}</EmptyState> : null}
    </>
  );
}

/**
 * Size, in the pop-up over Create, as on the desktop: the model's native
 * resolutions as one full-width toggle, then one vertical list of the shapes
 * (the shared list rows: the shape, its name, the size it makes and the amber
 * tick), Custom last, then Width and Height, always in view and enabled only
 * while Custom is the pick. A shape or resolution goes back to the preset.
 */
const shapeIn = (w: number, h: number) => { const scale = Math.min(22 / (w || 1), 16 / (h || 1)); return { width: Math.max(6, Math.round(w * scale)), height: Math.max(6, Math.round(h * scale)) }; };

type SizeView = Pick<StudioViewModel, 'aspectOptions' | 'aspectPickerValue' | 'aspectValue' | 'defaultAspectSize' | 'applyAspect' | 'mode' | 'currentProfile' | 'customSize' | 'sizeTier' | 'sizeMax' | 'customLimits' | 'chooseSizeTier' | 'setCustomDimensions' | 'sizeTiers' | 'sizeArea' | 'megapixelControl'>;

export function PhoneSize({ view }: { view: SizeView }) {
  const {
    aspectOptions, aspectPickerValue, aspectValue, defaultAspectSize, applyAspect, mode, currentProfile, customSize, sizeTier, sizeMax, customLimits,
    chooseSizeTier, setCustomDimensions, sizeTiers, sizeArea, megapixelControl
  } = view;
  const tier: SizeTier = customSize ? 'custom' : sizeTier || 'none';
  const tiers: SizeTier[] = sizeTiers || (mode === 'image' ? ['none', '2k', 'custom'] : ['none', 'custom']);
  const { custom, picked, shown, rows, isActive, note } = sizeMenuModel({ value: aspectPickerValue, options: aspectOptions || [], currentSize: aspectValue, defaultSize: defaultAspectSize, tier, native: currentProfile?.native, sizeMax, limits: customLimits, targetArea: sizeArea || 0 });
  const resolutions = tiers.filter((item) => item !== 'custom');
  return (
    <div className="phone-size">
      {resolutions.length > 1 ? <SizeTabs tiers={resolutions} labelled={false} value={tier} onChange={(next) => { chooseSizeTier(next); }} /> : null}
      <div className="list-group size-options" role="listbox" aria-label="Shape">
        {rows.map((row) => (
          <ListButton key={row.key} className="size-option" role="option" aria-selected={isActive(row)} selected={isActive(row)} end="check"
            aria-label={`${row.small ? `${row.label}, ${row.small}` : row.label}, ${row.size.width} × ${row.size.height}`}
            lead={<span className="aspect-shape" style={shapeIn(row.shape.w, row.shape.h)} />}
            label={<>{row.label}{row.small ? <small>{row.small}</small> : null}</>}
            value={`${row.size.width}×${row.size.height}`}
            onClick={() => applyAspect(row.value)} />
        ))}
        {customLimits ? (
          <ListButton className="size-option is-custom" role="option" aria-selected={custom} selected={custom} end="check"
            aria-label={custom ? `Custom, ${picked.width} × ${picked.height}` : 'Custom'}
            lead={<span className="aspect-shape" style={shapeIn(shown.width, shown.height)} />}
            label="Custom" value={custom ? `${picked.width}×${picked.height}` : ''}
            onClick={() => chooseSizeTier('custom')} />
        ) : null}
      </div>
      {megapixelControl ? <div className="phone-size-mp"><MegapixelField current={(shown.width * shown.height) / MEGAPIXEL} control={megapixelControl} custom={custom} /></div> : null}
      {customLimits ? <div className="size-custom phone-size-fields"><LinkedSizeFields size={custom ? picked : shown} limits={customLimits} onChange={setCustomDimensions} disabled={!custom} /></div> : null}
      {note ? <p className="list-note">{note}</p> : null}
    </div>
  );
}

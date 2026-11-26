// The built-in styles that seed Library › Templates (prompt-styles.js) in a data folder that has
// none: Improve Prompt's rewrite styles, Animate's themes (prompt-animate.js), then Edit and
// Recreate's fixed AI changes, each asked for as a suggestion's request is. An Improve
// Prompt style is an instruction block added after the profile's guide; a guide may replace one
// with its own `presets.<id>` text. Each sets only the tone; the content rule
// (domain/writing-standard.ts) decides how explicit it may be, and an `uncensored` style is only
// for accounts with Uncensored Models.
import { promptInstruction } from "./prompt-instructions.js";
import { flux3Upsampler } from "./prompt-upsamplers.js";

export const seedStyles = Object.freeze([
  {
    id: "candid",
    kind: "improve",
    label: "Candid",
    description: "Unposed, mid-moment, natural light",
    enabled: true,
    instruction:
      "Candid. Find the instant just before or after the requested action. Use an unposed gesture, a natural" +
      " eye line and the light the location already provides. Name one real surface or object the subject" +
      " interacts with. Keep the requested medium, people and setting.",
  },
  {
    id: "cinematic",
    kind: "improve",
    label: "Cinematic",
    description: "Frame the story beat, motivated light",
    enabled: true,
    instruction:
      "Cinematic. Decide what the viewer should notice first and where their attention goes next. Place the" +
      " subject relative to one foreground or background element already in the scene. Use a plausible light" +
      " source to separate them. Keep the story, people and location.",
  },
  {
    id: "concise",
    kind: "improve",
    label: "Concise",
    description: "Short, only the details that matter",
    enabled: true,
    instruction:
      "Concise. Keep the subject, distinctive relationships or counts, requested framing, visual medium and" +
      " exact quoted text. Remove adjectives that repeat the scene or merely praise it. Follow the guide's" +
      " required sections and length. Where the guide has no minimum, use one short sentence or a few tags if it" +
      " asks for tags.",
  },
  {
    id: "enhance",
    kind: "improve",
    label: "Enhance",
    description: "Expand what is already there",
    enabled: true,
    instruction:
      "Enhance. Expand what the request already commits to. Choose up to three useful details that make the" +
      " form, material, position, lighting or intended action visible. If an object is handled, clarify its" +
      " contact with the subject. Keep the source's medium, subject and intent.",
  },
  {
    id: "fix",
    kind: "improve",
    label: "Fix Issues",
    description: "Fix counts, contact, anatomy, text",
    enabled: true,
    instruction:
      "Fix Issues. Resolve the specific ambiguity most likely to spoil the result. State exact counts, explicit" +
      " contacts and which person or object does what. Where anatomy matters, describe the intended visible" +
      " proportions, contours and individual digits in the pose. Describe a readable silhouette or an" +
      " unobstructed area for any requested lettering, and preserve its wording verbatim. Keep the intended" +
      " appearance and framing.",
  },
  {
    id: "illustration",
    kind: "improve",
    label: "Illustration",
    description: "A coherent drawn medium",
    enabled: true,
    instruction:
      "Illustration. Use the art medium named in the prompt or choose one that helps this subject read." +
      " Describe two qualities that identify the medium, such as dry pencil hatching and grainy paper or a sharp" +
      " ink contour and a pooled wash. Apply them consistently to the same subject, outfit and location, and" +
      " keep the requested action.",
  },
  {
    id: "photographic",
    kind: "improve",
    label: "Photographic",
    description: "Camera distance, focus and real light",
    enabled: true,
    instruction:
      "Photographic. Establish a camera height and working distance that suit the existing composition. Say" +
      " what is in sharp focus, how the foreground and background separate, and where the light comes from. Show" +
      " material texture in the parts that are in focus. Name a lens only where it explains a visible effect and" +
      " the guide uses that language. Keep the source scene.",
  },
  {
    id: "portrait",
    kind: "improve",
    label: "Portrait",
    description: "Readable face, expression, identity",
    enabled: true,
    instruction:
      "Portrait. Direct attention to the subject's established face, expression and eye line. Choose framing" +
      " and side or frontal light that show their identity. Retain distinctive features, age, build, marks and" +
      " styling. For a nonhuman subject, use its identifying shape, markings and pose. Keep the existing setting" +
      " and any requested action.",
  },
  {
    id: "action",
    kind: "animate",
    label: "Action & Follow-Through",
    description: "One action, contact and follow-through",
    enabled: true,
    instruction:
      "Action & Follow-Through. Start at the pose or physical state in the source frame. Choose one energetic" +
      " action the space, available objects and clip length support. Show the drive into it and what takes the" +
      " impact or weight, then one readable follow-through. If the subject is inanimate, use a visible" +
      " displacement or motion already implied by the frame. Keep one clear viewpoint on the action.",
  },
  {
    id: "atmosphere",
    kind: "animate",
    label: "Moving Surroundings",
    description: "Move the surroundings, hold the frame",
    enabled: true,
    instruction:
      "Moving Surroundings. Lock the opening composition and let one element of the surroundings move through" +
      " it. Use a reflection, loose fabric, water or another feature actually present. State where the movement" +
      " begins, what it crosses and where it settles. Keep the subject's pose, expression, outfit and position" +
      " steady or continuing at the same pace.",
  },
  {
    id: "changing-light",
    kind: "animate",
    label: "Light Shift",
    description: "One light travels across the scene",
    enabled: true,
    instruction:
      "Light Shift. Keep the same place, weather, time of day and framing. Pick a plausible moving or changing" +
      " light source that fits the frame. Show where its light or shadow first falls, how it crosses an existing" +
      " surface, and the light that remains at the end. Permit one small response from the subject if" +
      " appropriate. Keep identity, outfit and physical positions continuous.",
  },
  {
    id: "cinematic",
    kind: "animate",
    label: "Motivated Camera Move",
    description: "One justified camera move",
    enabled: true,
    instruction:
      "Motivated Camera Move. If the subject is moving, choose one camera move that keeps its action readable." +
      " Give the move a direction, a stopping point and the reason that part of the scene needs to be visible." +
      " When the frame suggests a still subject, use one side move only if it changes how established elements" +
      " overlap. Keep the original person, outfit, place and action.",
  },
  {
    id: "dialogue",
    kind: "animate",
    label: "Short Dialogue",
    description: "A short line and a reaction",
    enabled: true,
    instruction:
      "Short Dialogue. If the selected model makes sound and the source supports speech, give one established" +
      " speaker a brief line that makes sense in this exact moment. Make the speaker's mouth readable and leave" +
      " room for a listener's glance, nod or reply only when time permits. Without a plausible speaker, use an" +
      " established cue and its visible response.",
  },
  {
    id: "living",
    kind: "animate",
    label: "Candid Continuation",
    description: "The next ordinary little step",
    enabled: true,
    instruction:
      "Candid Continuation. Treat the source as the first instant of an ordinary moment. Let the activity" +
      " already under way carry two linked steps, the first setting up the second, then settle and hold." +
      " Describe one visible contact and its consequence, such as a hand tilting a cup it already holds and then" +
      " setting it down. Keep the shot size and visual treatment. A slight reframe is useful only if it keeps" +
      " the action in view.",
  },
  {
    id: "reaction",
    kind: "animate",
    label: "Notice & Respond",
    description: "A cue and a visible response",
    enabled: true,
    instruction:
      "Notice & Respond. Pick one thing already in the frame that could draw the subject's attention. Show what" +
      " changes first in the eyes, ears or head, then what the hands, face or posture do in response. A playful" +
      " answer counts: a smile, a raised brow or a returned gesture, and end on it. For an inanimate subject," +
      " show a visible physical response between elements already there. Keep the framing on the response.",
  },
  {
    id: "reveal",
    kind: "animate",
    label: "Reveal a Detail",
    description: "Uncover a detail the frame hints at",
    enabled: true,
    instruction:
      "Reveal a Detail. Find a detail the opening frame has partly hidden or points toward. Identify what is" +
      " obscuring it and what motion can bring it into view. Show the cue first and end with the detail readable" +
      " in relation to the original subject. Use the subject's own movement or one motivated camera move." +
      " Preserve the original setting and supply only details the source supports.",
  },
  {
    id: "wider",
    kind: "change",
    label: "Wider Composition",
    description: "More of the same space, same angle",
    enabled: true,
    instruction:
      "Reframe from the same viewing angle at a wider shot size. Continue the floor, walls or landscape already" +
      " visible so the extra space belongs to the same location. Describe where the original subject now sits in" +
      " the wider frame. Keep their identity, outfit, activity and the light's direction.",
    actions: ["recreate"],
  },
  {
    id: "relight",
    kind: "change",
    label: "Relight",
    description: "Change the light's quality and direction",
    enabled: true,
    instruction:
      "Change the light in one clear way that suits this scene: warm golden light, soft overcast light," +
      " dramatic side light, or a hard practical lamp. Choose one that clearly differs from the current light" +
      " and say where the new light falls and how surfaces respond. Keep identity, face, build, pose, framing" +
      " and light.",
  },
  {
    id: "expression",
    kind: "change",
    label: "New Expression",
    description: "A different, natural expression",
    enabled: true,
    instruction:
      "Give the main subject a clearly different, natural expression that suits the scene, such as a broad" +
      " laugh, a soft smile, surprise, concentration, a playful smirk or calm. Choose one that differs from the" +
      " current expression and describe the eyes, brows and mouth. For a nonhuman subject, change a posture cue" +
      " such as raised ears or a tilted head. Keep identity, face, build, pose, framing and light. Keep the" +
      " hands and outfit.",
  },
  {
    id: "hairstyle",
    kind: "change",
    label: "New Hairstyle",
    description: "A different hairstyle, same face",
    enabled: true,
    instruction:
      "Give the subject a different hairstyle that suits their look and the setting, such as an updo, loose" +
      " waves, a braid, a sleek ponytail or a new color. Choose one clearly different from the current hair and" +
      " describe its length, texture, parting and how it falls around the face and shoulders. Keep identity," +
      " face, build, pose, framing and light. Keep the outfit.",
  },
  {
    id: "add-prop",
    kind: "change",
    label: "Add a Prop",
    description: "One fitting object, believable contact",
    enabled: true,
    instruction:
      "Add one object that belongs in this place and moment, such as a drink, flowers, a phone, an umbrella or" +
      " a pet. Choose it from the setting and activity rather than a stock item. Place it in a free hand or on a" +
      " nearby surface with believable contact, scale, shadow and reflections. Keep identity, face, build, pose," +
      " framing and light. Keep the outfit and the rest of the frame.",
  },
  {
    id: "time-season-weather",
    kind: "change",
    label: "Time, Season or Weather",
    description: "Another time, season or weather",
    enabled: true,
    instruction:
      "Set the same subject, location and action at a clearly different time, season or weather that fits the" +
      " place: dawn, golden hour, night, falling snow, rain, fog or autumn leaves. Choose one that differs from" +
      " the source. Light it with sources that belong there and show how surfaces and the sky respond. Keep the" +
      " composition, identity, wardrobe and essential props.",
    actions: ["recreate"],
  },
  {
    id: "simple-background",
    kind: "change",
    label: "Simplify Background",
    description: "Calm the clutter behind the subject",
    enabled: true,
    instruction:
      "Simplify the background immediately behind the subject by removing or softening secondary visual" +
      " clutter. Keep the main features that identify the location and all props involved in the action." +
      " Preserve the subject, foreground, camera angle, light direction and existing depth.",
  },
  {
    id: "new-angle",
    kind: "change",
    label: "New Angle",
    description: "A different position, same shot size",
    enabled: true,
    instruction:
      "Choose a viewing position that gives a different, physically plausible view of this exact moment." +
      " Specify the new camera height and side, and one already established detail it reveals or brings into" +
      " alignment. Keep identity, face, build, pose, framing and light. Keep the shot size, outfit and place.",
    actions: ["recreate"],
  },
  {
    id: "new-action",
    kind: "change",
    label: "New Action",
    description: "A new action that fits the place",
    enabled: true,
    instruction:
      "Choose one new action the same subject could do in the same setting using what is already available." +
      " Pick the instant where one gesture or point of contact makes it clearly readable. Keep identity," +
      " clothes, framing and visual style. Keep the original lighting unless the new position naturally changes" +
      " how it falls.",
  },
  {
    id: "new-pose",
    kind: "change",
    label: "New Pose",
    description: "A different natural pose, same place",
    enabled: true,
    instruction:
      "Recreate the scene with the same subject in a clearly different pose that suits the setting and their" +
      " activity, such as seated instead of standing, leaning on something nearby, glancing over a shoulder or" +
      " mid-stride. Describe the body position, where the weight rests and what the hands do. Keep identity," +
      " face, build, framing and light. Keep the location, outfit and visual style.",
  },
  {
    id: "closer-shot",
    kind: "change",
    label: "Closer Shot",
    description: "Tighter: portrait, detail or crop",
    enabled: true,
    instruction:
      "Recompose this scene as a closer shot, choosing what suits the image: a head-and-shoulders portrait, a" +
      " waist-up shot, or a close detail of hands, an object or a texture. Describe the framing, where focus" +
      " falls and what the background becomes. Keep identity, outfit, place and light.",
    actions: ["recreate"],
  },
  {
    id: "new-setting",
    kind: "change",
    label: "Move to a New Place",
    description: "Move the action somewhere plausible",
    enabled: true,
    instruction:
      "Choose a different place where the same action remains plausible. Give it two distinctive spatial or" +
      " material details and light it in a way that belongs there. Keep the same subject, identity, outfit," +
      " activity and visual style, along with the shot scale.",
    actions: ["recreate"],
  },
  {
    id: "new-outfit-and-place",
    kind: "change",
    label: "New Outfit & Place",
    description: "A new outfit and a place that suits it",
    enabled: true,
    instruction:
      "Choose a new location and an outfit that belongs there, both different from the source. Give the place" +
      " two distinctive details and fitting light, and describe the outfit's cut, fabric and colors. Keep the" +
      " subject's identity, build, expression and visual style, in a natural pose for the new place.",
    actions: ["recreate"],
  },
  {
    id: "wardrobe-swap",
    kind: "change",
    label: "Wardrobe Swap",
    description: "Replace the outfit, keep the rest",
    enabled: true,
    instruction:
      "Choose a coherent replacement outfit suited to the existing activity and place. Give it a different" +
      " silhouette or fabric, with specific colors. Fit the clothes to the current pose and keep the face," +
      " build, expression, action, framing and surroundings unchanged.",
  },
  {
    id: "new-visual-treatment",
    kind: "change",
    label: "Art Medium",
    description: "Same composition, another medium",
    enabled: true,
    instruction:
      "Render the scene in one clearly different art medium, such as ink and wash, relief print, cut paper or" +
      " painted animation, chosen to suit the subject. Preserve the framing, visual hierarchy and placement of the" +
      " main shapes. Describe the new medium's identifying" +
      " marks, edge treatment and palette, and keep identity, outfit, action, objects and setting.",
  },
  {
    id: "photographic-realism",
    kind: "change",
    label: "Photographic Realism",
    description: "Make it read as a real photograph",
    enabled: true,
    instruction:
      "Render this as a believable photograph. As an edit, keep the composition and every object where they are" +
      " and give the existing light a plausible source and direction. As a recreate, take a new camera position" +
      " with the subject a plausible place to stand or move. In both, keep identity, outfit and action, preserve" +
      " natural proportions, and choose tactile materials, contact shadows and depth of field.",
  },
  {
    id: "remove-distraction",
    kind: "change",
    label: "Remove Distraction",
    description: "Remove one object, rebuild behind it",
    enabled: true,
    instruction:
      "Remove the most distracting secondary object that can be removed without changing the subject, story or" +
      " action. Name the object and its location. Rebuild only the surface it covered, matching neighboring" +
      " texture, perspective and light. Preserve every other part of the frame.",
    actions: ["edit"],
  },
  {
    id: "repair-detail",
    kind: "change",
    label: "Repair Detail",
    description: "Repair one visible flaw",
    enabled: true,
    instruction:
      "Find one visible rendering error, such as a broken finger contact, doubled edge, inconsistent" +
      " reflection, extra nipple or garbled intended lettering. Name where it is and describe the smallest" +
      " plausible correction. Keep identity, expression, pose, lighting, framing and all surrounding details." +
      " Preserve intended text verbatim when known.",
    actions: ["edit"],
  },
]);

/**
 * System styles are built in rather than records: always offered, never stored, untouched by saves and
 * versions. Follow Guide applies the selected model's family guide as the whole instruction, so a
 * rewrite can use the guide alone without a tone on top of it.
 */
export const systemStyles = Object.freeze({
  improve: Object.freeze([
    Object.freeze({
      id: "guide",
      kind: "improve",
      label: "Follow Guide",
      description: "The model's guide, no tone added",
      system: true,
      enabled: true,
      instruction:
        "Follow Guide. Put every required subject, detail and action into the parts of the selected model's guide that govern them. Match its format, order, vocabulary and length. Use its examples to understand the structure, then write only about the requested scene. Preserve any exact names and quoted text.",
    }),
    Object.freeze({
      id: "structure",
      kind: "improve",
      label: "One Prompt",
      description: "Notes and fixes into one prompt",
      system: true,
      enabled: true,
      instruction:
        'One Prompt. Read the input as a set of requests rather than a finished prompt: loose notes, several subjects or beats, and corrections such as "make it night" partway through. Apply them all, with a later line overriding an earlier one where they disagree, and drop what a correction replaces. Merge repeated subjects so each is described once. Order everything as the guide asks, from subject outward, with one light and one style. Reply with the single finished prompt only, with none of the note-taking left in it.',
    }),
  ]),
});

/** Custom… is built in rather than a record, by kind: it frames the person's own instruction. */
export const customStyles = Object.freeze({
  improve: {
    id: "custom",
    kind: "improve",
    label: "Custom",
    description: "Your own instruction",
    custom: true,
    enabled: true,
    get instruction() {
      return promptInstruction("custom-rewrite");
    },
  },
  animate: {
    id: "custom",
    kind: "animate",
    label: "Custom",
    description: "Your own instruction",
    custom: true,
    enabled: true,
    get instruction() {
      return promptInstruction("custom-animate");
    },
  },
});

export const defaultPreset = "enhance";

// A Custom instruction's length limit.
export const maxInstructionCharacters = 500;

/**
 * Words about speed, quality tier, model, size, aspect or count: settings, not scene. The rewrite
 * instructions name them and the eval scorer checks no rewrite adds them.
 */
export const settingWords = Object.freeze([
  "turbo",
  "super fast",
  "draft mode",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "2k",
  "4k",
  "megapixel",
  "two images",
  "three images",
  "aspect ratio",
]);

/**
 * Families meant to run behind a maker's prompt upsampler: Enhance uses its Library instruction
 * (prompt-upsamplers.js), which defaults to the maker's wording, and runs
 * on the maker's upsampler `model` once the gateway lists it.
 */
const flux3 = () => ({ ...flux3Upsampler, model: "local/flux-pup" });
const upsamplers = { flux3, flux3_klein: flux3 };
const familyKey = (family) => String(family || "").replace(/-/g, "_");

export function familyUpsampler(profile) {
  return upsamplers[familyKey(profile?.family)]?.() || null;
}

/** Specialised family prompt upsampler models (such as local/flux-pup), not general text LLMs. */
export function upsamplerModels() {
  return [...new Set(Object.values(upsamplers).map((factory) => factory().model))];
}

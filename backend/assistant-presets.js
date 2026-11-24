// The built-in styles that seed Library › Prompt Styles (prompt-styles.js) in a data folder that has
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
    enabled: true,
    label: "Candid",
    description: "An unposed photograph with one ordinary, scene-specific gesture.",
    instruction:
      "Candid. Find the instant just before or after the requested action. Use an unposed gesture, a natural eye line and the light the location already provides. Name one real surface or object the subject interacts with. Keep the requested medium, people and setting. For video, show that same small action at everyday speed.",
  },
  {
    id: "cinematic",
    kind: "improve",
    enabled: true,
    label: "Cinematic",
    description: "Direct attention to the story beat with framing and motivated light.",
    instruction:
      "Cinematic. Decide what the viewer should notice first and where their attention goes next. Place the subject relative to one foreground or background element already in the scene. Use a plausible light source to separate them. For a clip, give the stated action an opening beat and a visible payoff. Keep the story, people and location.",
  },
  {
    id: "concise",
    kind: "improve",
    enabled: true,
    label: "Concise",
    description: "A compact prompt with the details that actually change the result.",
    instruction:
      "Concise. Keep the subject, distinctive relationships or counts, requested framing, visual medium and exact quoted text. Keep a video's essential action in order. Remove adjectives that repeat the scene or merely praise it. Follow the guide's required sections and length. Where the guide has no minimum, use one short sentence or a few tags if it asks for tags.",
  },
  {
    id: "enhance",
    kind: "improve",
    enabled: true,
    label: "Enhance",
    description: "Make the original subject, action and materials easier to picture.",
    instruction:
      "Enhance. Expand what the request already commits to. Choose up to three useful details that make the form, material, position, lighting or intended action visible. If an object is handled, clarify its contact with the subject. In video, state what changes first and what the movement leaves in view. Keep the source's medium, subject and intent.",
  },
  {
    id: "fix",
    kind: "improve",
    enabled: true,
    label: "Fix Issues",
    description: "Clarify counts, contact, proportions, lettering and motion.",
    instruction:
      "Fix Issues. Resolve the specific ambiguity most likely to spoil the result. State exact counts, explicit contacts and which person or object does what. Describe a readable silhouette or an unobstructed area for any requested lettering, and preserve its wording verbatim. For video, put movements in order and give the shot one consistent camera path. Keep the intended appearance and framing.",
  },
  {
    id: "guide",
    kind: "improve",
    enabled: true,
    label: "Follow Guide",
    description: "Fit the selected model's prompt structure while retaining the brief.",
    instruction:
      "Follow Guide. Put every required subject, detail and action into the parts of the selected model's guide that govern them. Match its format, order, vocabulary and length. Use its examples to understand the structure, then write only about the requested scene. Preserve any exact names and quoted text.",
  },
  {
    id: "graphic-poster",
    kind: "improve",
    enabled: true,
    censored: true,
    label: "Graphic Poster",
    description: "Turn the scene into a poster with clear shapes and deliberate space.",
    instruction:
      "Graphic Poster. Build the composition around one silhouette, a strong secondary shape and clean negative space. Use a small palette with one accent color. Keep the requested people, objects and theme. Arrange requested lettering as part of the layout and preserve it verbatim. Leave the design pictorial when the request contains no lettering. For video, keep the graphic treatment as the shapes move.",
  },
  {
    id: "illustration",
    kind: "improve",
    enabled: true,
    label: "Illustration",
    description: "Render the scene in a distinct, coherent illustration medium.",
    instruction:
      "Illustration. Use the art medium named in the prompt or choose one that helps this subject read. Describe two qualities that identify the medium, such as dry pencil hatching and grainy paper or a sharp ink contour and a pooled wash. Apply them consistently to the same subject, outfit and location. Keep the requested motion and hold the rendering treatment throughout a clip.",
  },
  {
    id: "photographic",
    kind: "improve",
    enabled: true,
    label: "Photographic",
    description: "Specify camera distance, focus and real light for a photographic look.",
    instruction:
      "Photographic. Establish a camera height and working distance that suit the existing composition. Say what is in sharp focus, how the foreground and background separate, and where the light comes from. Show material texture in the parts that are in focus. Name a lens only where it explains a visible effect and the guide uses that language. Keep the source scene and apply the same photographic treatment throughout a clip.",
  },
  {
    id: "portrait",
    kind: "improve",
    enabled: true,
    label: "Portrait",
    description: "Make the subject's existing identity and expression easy to read.",
    instruction:
      "Portrait. Direct attention to the subject's established face, expression and eye line. Choose framing and side or frontal light that show their identity. Retain distinctive features, age, build, marks and styling. For a nonhuman subject, use its identifying shape, markings and pose. Keep the existing setting and any requested action.",
  },
  {
    id: "uncensored",
    kind: "improve",
    enabled: true,
    label: "Uncensored",
    description: "Develop the intimacy in the request for models that allow it.",
    uncensored: true,
    instruction:
      "Uncensored. Build the requested intimacy from the established adults, their actions and the setting. Make each intended expression, movement or touch specific to that scene. Follow the content guidance and preserve identities, continuity and the chosen medium.",
  },
  {
    id: "action",
    kind: "animate",
    enabled: true,
    label: "Action & Follow-Through",
    description: "One energetic action with clear contact and follow-through.",
    instruction:
      "Action & Follow-Through. Start at the pose or physical state in the source frame. Choose one energetic action the space, available objects and clip length support. Show the drive into it and what takes the impact or weight, then one readable follow-through. If the subject is inanimate, use a visible displacement or motion already implied by the frame. Keep one clear viewpoint on the action.",
  },
  {
    id: "atmosphere",
    kind: "animate",
    enabled: true,
    censored: true,
    label: "Moving Surroundings",
    description: "Give movement to visible surroundings while holding the composition.",
    instruction:
      "Moving Surroundings. Lock the opening composition and let one element of the surroundings move through it. Use a reflection, loose fabric, water or another feature actually present. State where the movement begins, what it crosses and where it settles. Keep the subject's pose, expression, outfit and position steady or continuing at the same pace.",
  },
  {
    id: "changing-light",
    kind: "animate",
    enabled: true,
    label: "Light Shift",
    description: "Let a single change of light travel over the established scene.",
    instruction:
      "Light Shift. Keep the same place, weather, time of day and framing. Pick a plausible moving or changing light source that fits the frame. Show where its light or shadow first falls, how it crosses an existing surface, and the light that remains at the end. Permit one small response from the subject if appropriate. Keep identity, outfit and physical positions continuous.",
  },
  {
    id: "cinematic",
    kind: "animate",
    enabled: true,
    label: "Motivated Camera Move",
    description: "Follow the action with one justified camera move.",
    instruction:
      "Motivated Camera Move. Match the framing of the opening image first. If the subject is moving, choose one camera move that keeps its action readable. Give the move a direction, a stopping point and the reason that part of the scene needs to be visible. When the frame suggests a still subject, use one side move only if it changes how established elements overlap. Keep the original person, outfit, place and action.",
  },
  {
    id: "dialogue",
    kind: "animate",
    enabled: true,
    label: "Short Dialogue",
    description: "Build a short, scene-specific exchange and show the listener react.",
    instruction:
      "Short Dialogue. If the selected model makes sound and the source supports speech, give one established speaker a brief line that makes sense in this exact moment. Make the speaker's mouth readable and leave room for a listener's glance, nod or reply only when time permits. In a silent profile, tell the exchange through expression, eye line and one visible gesture. Without a plausible speaker, use an established cue and its visible response.",
  },
  {
    id: "living",
    kind: "animate",
    enabled: true,
    label: "Candid Continuation",
    description: "Carry the moment into its next ordinary, unposed step.",
    instruction:
      "Candid Continuation. Treat the source as the first instant of an ordinary moment. Let the activity already under way continue through one small step, then settle. Describe one visible contact and its consequence, such as a hand tilting a cup it already holds. Keep the shot size and visual treatment. A slight reframe is useful only if it keeps the action in view.",
  },
  {
    id: "locked-camera",
    kind: "animate",
    enabled: true,
    label: "Fixed Shot",
    description: "Hold the exact shot while a foreground gesture changes the frame.",
    instruction:
      "Fixed Shot. Keep camera position, focus distance and framing fixed from the first frame. Choose a gesture or shift of weight that the current pose can turn into clearly. Let it start early and show a clear end position within the existing frame. With no living subject, move an existing object in a way the source can physically support. Preserve the scene and camera throughout.",
  },
  {
    id: "playful",
    kind: "animate",
    enabled: true,
    label: "Playful Exchange",
    description: "Build a light interaction around something already in the frame.",
    instruction:
      "Playful Exchange. Begin from the established pose, then let one subject make a brief playful move with a person, animal or object already there. Show the response it draws and finish on a smile, a return gesture or the object coming to rest. Fit the exchange to the available time and space. Keep the interaction visible in one shot and preserve the participants.",
  },
  {
    id: "reaction",
    kind: "animate",
    enabled: true,
    label: "Notice & Respond",
    description: "Turn an existing cue into a clearly visible reaction.",
    instruction:
      "Notice & Respond. Pick one thing already in the frame that could draw the subject's attention. Show what changes first in the eyes, ears or head, then what the hands, face or posture do in response. End on the new expression or settled pose. For an inanimate subject, show a visible physical response between elements already there. Keep the framing on the response.",
  },
  {
    id: "reveal",
    kind: "animate",
    enabled: true,
    label: "Reveal a Detail",
    description: "Uncover one detail that the opening image already suggests.",
    instruction:
      "Reveal a Detail. Find a detail the opening frame has partly hidden or points toward. Identify what is obscuring it and what motion can bring it into view. Show the cue first and end with the detail readable in relation to the original subject. Use the subject's own movement or one motivated camera move. Preserve the original setting and supply only details the source supports.",
  },
  {
    id: "focus-pull",
    kind: "animate",
    enabled: true,
    label: "Focus Pull",
    description: "Shift focus between two visible depths in a fixed shot.",
    instruction:
      "Focus Pull. Hold the camera and start with a visible detail at one distance in focus. Pull focus once to an established subject at another distance and hold their new sharpness. Preserve the scene and subject poses unless the source implies a small continuation. In a single-plane source, hold focus and let the subject draw attention with one small movement instead.",
  },
  {
    id: "loop",
    kind: "animate",
    enabled: true,
    label: "Seamless Loop",
    description: "Repeat one natural motion and return to the opening frame.",
    instruction:
      "Seamless Loop. Choose one repeating movement the source already suggests, such as a turn of a fan or a sway of a hanging object. Hold the viewpoint and make the movement return to the opening position and direction by the last frame. Keep light, framing and every nonmoving detail steady. Avoid making time run backward to reset a one-way action.",
  },
  {
    id: "uncensored",
    kind: "animate",
    enabled: true,
    label: "Uncensored",
    description: "Animate the requested intimacy with continuous action and framing.",
    uncensored: true,
    instruction:
      "Uncensored. Work with the adults already in the frame, the established setting and the intimacy the request supports. Start from the present pose, show a deliberate change in expression, contact or weight, and keep the movement continuous through the last frame. Use close framing only where it helps the action stay readable. Follow the content guidance.",
  },
  {
    id: "closer",
    kind: "change",
    enabled: true,
    label: "Closer Crop",
    description: "Crop around the subject and preserve the existing viewpoint.",
    instruction:
      "Crop in from the existing viewpoint until the main subject occupies more of the frame. Keep the nearest point of contact or detail that explains the action inside the crop. Preserve the subject's identity, pose, lighting, perspective and all retained details.",
    actions: ["edit", "recreate"],
  },
  {
    id: "wider",
    kind: "change",
    enabled: true,
    label: "Wider Composition",
    description: "Show more of the established space from the same viewpoint.",
    instruction:
      "Reframe from the same viewing angle at a wider shot size. Continue the floor, walls or landscape already visible so the extra space belongs to the same location. Describe where the original subject now sits in the wider frame. Keep their identity, outfit, activity and the direction of the light.",
    actions: ["recreate"],
  },
  {
    id: "warmer",
    kind: "change",
    enabled: true,
    label: "Warm the Light",
    description: "Warm the established light while keeping the original scene and shadows.",
    instruction:
      "Warm the existing light, keeping its direction, shadow softness and time of day. Specify which lit surfaces gain a gentle amber cast and leave the shadows neutral enough for the original material colors to read. Preserve the subject, pose, setting and framing.",
    actions: ["edit"],
  },
  {
    id: "night",
    kind: "change",
    enabled: true,
    label: "After Dark",
    description: "Show the same place and action after dark.",
    instruction:
      "Set the same subject, location and action after dark. Light them with one source that belongs in this place and describe where that light reaches. Keep the composition, identities, wardrobe and essential props. Make the subject readable against the darker surroundings.",
    actions: ["edit", "recreate"],
  },
  {
    id: "simple-background",
    kind: "change",
    enabled: true,
    label: "Simplify Background",
    description: "Calm busy background details without changing the location.",
    instruction:
      "Simplify the background immediately behind the subject by removing or softening secondary visual clutter. Keep the main features that identify the location and all props involved in the action. Preserve the subject, foreground, camera angle, light direction and existing depth.",
    actions: ["edit"],
  },
  {
    id: "new-angle",
    kind: "change",
    enabled: true,
    label: "Change Viewpoint",
    description: "See the same moment from a different position at the same shot size.",
    instruction:
      "Choose a viewing position that gives a different, physically plausible view of this exact moment. Specify the new camera height and side, and one already established detail it reveals or brings into alignment. Keep the shot size, subject, pose, outfit, place and lighting.",
    actions: ["recreate"],
  },
  {
    id: "new-action",
    kind: "change",
    enabled: true,
    label: "Change the Action",
    description: "Give the subject a new action that belongs in the same place.",
    instruction:
      "Choose one new action the same subject could do in the same setting using what is already available. Pick the instant where one gesture or point of contact makes it clearly readable. Keep identity, clothes, framing and visual style. Keep the original lighting unless the new position naturally changes how it falls.",
    actions: ["recreate"],
  },
  {
    id: "new-setting",
    kind: "change",
    enabled: true,
    label: "Move to a New Place",
    description: "Move the original subject and action to a distinctly different place.",
    instruction:
      "Choose a different place where the same action remains plausible. Give it two distinctive spatial or material details and light it in a way that belongs there. Keep the same subject, identity, outfit and activity, along with the shot scale and visual style. Choose the location from the brief and source rather than a stock scene.",
    actions: ["recreate"],
  },
  {
    id: "wardrobe-swap",
    kind: "change",
    enabled: true,
    label: "Wardrobe Swap",
    description: "Replace the outfit and keep the person, action and surroundings.",
    instruction:
      "Choose a coherent replacement outfit suited to the existing activity and place. Give it a different silhouette, layering or fabric, with specific colors. Fit the clothes to the current pose and keep the face, build, expression, action, framing and surroundings unchanged.",
    actions: ["edit", "recreate"],
  },
  {
    id: "new-visual-treatment",
    kind: "change",
    enabled: true,
    label: "Stylised Treatment",
    description: "Keep the composition and render it in a distinct art medium.",
    instruction:
      "Render the scene in one clearly different art medium, such as ink and wash, relief print, cut paper or painted animation. Choose one that suits the subject and differs from the source. Describe identifying marks, edge treatment and palette. Keep the subject's identity, pose, outfit, action, objects, setting and composition.",
    actions: ["edit", "recreate"],
  },
  {
    id: "photographic-realism",
    kind: "change",
    enabled: true,
    label: "Photographic Realism",
    description: "Make the same scene read as a real photograph.",
    instruction:
      "Render this composition as a believable photograph. Keep the same people, identity, pose, outfit, objects, action, location and framing. Give the existing light a plausible source and direction, preserve natural proportions, and choose material textures, contact shadows and depth of field that make this shot believable.",
    actions: ["edit", "recreate"],
  },
  {
    id: "remove-distraction",
    kind: "change",
    enabled: true,
    label: "Remove Distraction",
    description: "Remove one secondary object and restore the surface behind it.",
    instruction:
      "Remove the most distracting secondary object that can be removed without changing the subject, story or action. Name the object and its location. Rebuild only the surface it covered, matching neighboring texture, perspective and light. Preserve every other part of the frame.",
    actions: ["edit"],
  },
  {
    id: "repair-detail",
    kind: "change",
    enabled: true,
    label: "Repair Detail",
    description: "Repair one visible flaw while preserving the rest of the image.",
    instruction:
      "Find one visible rendering error, such as a broken finger contact, doubled edge, inconsistent reflection or garbled intended lettering. Name where it is and describe the smallest plausible correction. Keep identity, expression, pose, lighting, framing and all surrounding details. Preserve intended text verbatim when known.",
    actions: ["edit"],
  },
]);

/** Custom… is built in rather than a record, by kind: it frames the person's own instruction. */
export const customStyles = Object.freeze({
  improve: {
    id: "custom",
    kind: "improve",
    label: "Custom",
    description: "Your own instruction.",
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
    description: "Your own instruction.",
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

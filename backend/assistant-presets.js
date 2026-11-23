// The built-in styles that seed Library › Prompt Styles (prompt-styles.js) in a data folder that has
// none: Improve Prompt's rewrite styles, Animate's themes (prompt-animate.js), then Edit and
// Recreate's fixed AI changes, each asked for as a suggestion's request is. An Improve
// Prompt style is an instruction block added after the profile's guide; a guide may replace one
// with its own `presets.<id>` text. Each sets only the tone; the content rule
// (domain/writing-standard.ts) decides how explicit it may be, and an `uncensored` style is only
// for accounts with Uncensored Models.
import { flux3Upsampler } from "./prompt-upsamplers.js";

export const seedStyles = Object.freeze([
  {
    id: "candid",
    kind: "improve",
    enabled: true,
    label: "Candid",
    description: "Natural, unposed photography of real life.",
    instruction:
      "Candid: show an unposed moment at eye level in the available light. Use a candid photograph when no other medium is specified. Choose a gesture or point of attention that fits what the subject is already doing, and show texture in the surfaces and surroundings already present. Keep faces and materials natural and the subject clear. Avoid snapshot artifacts and stock props. For video, let the existing action play out at a natural pace.",
  },
  {
    id: "cinematic",
    kind: "improve",
    enabled: true,
    label: "Cinematic",
    description: "A story beat shaped by framing, light and color.",
    instruction:
      "Cinematic: frame the scene as a story beat. Use the subject's position in the frame, light direction from a plausible source, and a deliberate contrast between foreground and background to direct attention to the event. For a video, carry the event through an opening action and a visible payoff in the guide's format.",
  },
  {
    id: "concise",
    kind: "improve",
    enabled: true,
    label: "Concise",
    description: "Short and direct, essentials only.",
    instruction:
      "Concise: tighten it to the essentials: the subject, the details that change the picture, the style and the framing. Drop filler and every repeated or generic quality word. Where the guide sets a minimum length or wants a long caption, keep to that minimum rather than going under it; otherwise write one short sentence (under 30 words) or, where the guide prefers tags, a few comma-separated tags.",
  },
  {
    id: "enhance",
    kind: "improve",
    enabled: true,
    label: "Enhance",
    description: "Richer detail in the guide's own style.",
    instruction:
      "Enhance: retain the prompt's medium, subject and intent. Make the details already stated or implied more visible: shape, placement, material, the light falling on them, or a specific sequence of movement for video. Use the detail and structure the guide recommends.",
  },
  {
    id: "spicy",
    kind: "improve",
    enabled: true,
    label: "Extended Themes",
    description: "Sensual and explicit, for uncensored models.",
    uncensored: true,
    instruction:
      "Extended Themes: make the scene sensual and explicit, building on the request's own subjects and setting.",
  },
  {
    id: "fix",
    kind: "improve",
    enabled: true,
    label: "Fix Issues",
    description: "Prevents glitches: anatomy, text and muddled scenes.",
    instruction:
      "Fix Issues: untangle unclear placement, counts, conflicting directions and which subject is doing what. Specify spatial relationships, contacts and readable silhouettes in positive terms. Keep quoted text verbatim. In video, put the motions in order and resolve conflicting camera moves. Preserve the requested appearance, style and framing.",
  },
  {
    id: "guide",
    kind: "improve",
    enabled: true,
    label: "Follow Guide",
    description: "Rewritten to the model's prompting guide.",
    instruction:
      "Follow Guide: rewrite it strictly in the format, order, length and wording the prompting guide sets for this model, keeping every subject, detail and style the prompt asks for and adding nothing new.",
  },
  {
    id: "graphic-poster",
    kind: "improve",
    enabled: true,
    label: "Graphic Poster",
    description: "Bold silhouettes and an arranged, limited palette.",
    instruction:
      "Graphic Poster: arrange the existing subjects as distinct silhouettes at deliberate scales, with a limited set of flat colors and purposeful negative space. Place any requested lettering clearly and preserve its exact wording. Leave the layout purely pictorial when the request has no text. For video, retain the requested action and describe how the shapes move through the composition.",
  },
  {
    id: "illustration",
    kind: "improve",
    enabled: true,
    label: "Illustration",
    description: "Artwork in one specific medium and style.",
    instruction:
      "Illustration: render the scene in one chosen art medium. Use the medium the prompt names or choose one that suits the subject. Describe the marks and surfaces that distinguish it, such as ink contours and paper grain or opaque gouache strokes. For video, keep that rendering consistent as the requested action plays out.",
  },
  {
    id: "monochrome",
    kind: "improve",
    enabled: true,
    label: "Monochrome",
    description: "Grayscale tones that separate shapes and textures.",
    instruction:
      "Monochrome: keep the original medium and use grayscale tonal separation. State which existing surfaces catch the highlights, which read as midtones and where the shadows define shape. Where a named color carries story information or identifies an object, preserve its role with a clearly distinguishable tone. For video, keep moving subjects readable against their backgrounds.",
  },
  {
    id: "photographic",
    kind: "improve",
    enabled: true,
    label: "Photographic",
    description: "Deliberate photographic light, perspective and focus.",
    instruction:
      "Photographic: give the scene an intentional photographic treatment. Describe the working distance, perspective, focus and source and direction of light that show the subject clearly. Use visible material texture and restrained color. Name a lens only if it explains a visible effect and the guide uses that language. For video, retain the action and apply the look consistently through the shot.",
  },
  {
    id: "portrait",
    kind: "improve",
    enabled: true,
    label: "Portrait",
    description: "An identity-led study of the subject's face and expression.",
    instruction:
      "Portrait: make the person the clear focus when the scene already has one. Use the existing face, expression, eye line and pose, with a light direction and depth of field that separate them from the existing background. Preserve distinctive facial features, age, build and visible marks. For a nonhuman subject, work with the features and pose it has. In video, retain the requested action within a readable portrait framing.",
  },
  {
    id: "action",
    kind: "animate",
    enabled: true,
    label: "Action",
    description: "One energetic physical action and a readable follow-through.",
    instruction:
      "Action: choose one energetic action that this frame sets up. Begin at the established pose, state how the subject shifts or makes contact, and carry that momentum into one visible follow-through. Keep any secondary motion tied to that action. Use a fixed frame or one follow move that keeps the hands, feet or point of contact readable. Match the action's scale to the available space, clip length and frame rate.",
  },
  {
    id: "atmosphere",
    kind: "animate",
    enabled: true,
    label: "Atmosphere",
    description: "Visible movement in the surroundings, seen from a fixed frame.",
    instruction:
      "Atmosphere: hold the opening composition and make one established part of the surroundings move. Describe where the movement starts, what path it takes and what changes in the frame as it passes or settles. Choose something this setting can already support, such as a shifting reflection, water running off an edge or a draft moving loose fabric. Keep the subject's movement secondary and make the change readable without sound.",
  },
  {
    id: "body-bounce",
    kind: "animate",
    enabled: true,
    label: "Body Bounce",
    description: "Natural body follow-through after a footfall or landing.",
    uncensored: true,
    instruction:
      "Body Bounce: when the opening frame clearly depicts an adult person, use a step, landing, or rhythmic movement that their pose and surroundings support. Describe the weight transfer or impact first, then a small delayed bounce in the chest or buttocks, followed by a quick settle. Describe only motion visible through the existing clothing. Preserve the person's build, outfit, and proportions. Keep the movement at real-time speed and in readable framing. For other subjects, use ordinary secondary motion such as fabric or hair settling.",
  },
  {
    id: "cinematic",
    kind: "animate",
    enabled: true,
    label: "Cinematic Camera",
    description: "A camera move the subject's action motivates.",
    instruction:
      "Cinematic Camera: use one camera move the subject's action motivates. Begin at the opening angle and distance. Give the move a direction and a specific destination, such as tracking alongside the subject until the doorway they approach comes into view. Describe how shapes overlap or separate as the framing changes and keep the subject's placement continuous.",
  },
  {
    id: "dialogue",
    kind: "animate",
    enabled: true,
    label: "Dialogue",
    description: "A brief line or exchange with a visible reaction.",
    instruction:
      "Dialogue: when someone in the frame can speak, start with one brief line and leave time for a visible reaction. A second line needs an established listener and enough clip time. Frame the speaker so their mouth is readable. For silent models, show the communication in mouth movement, gaze and gesture. Where there is no plausible speaker, use a visible exchange or response supported by the frame.",
  },
  {
    id: "spicy",
    kind: "animate",
    enabled: true,
    label: "Extended Themes",
    description: "Slow, sensual and explicit, for uncensored models.",
    uncensored: true,
    instruction:
      "Extended Themes: slow, sensual, explicit motion built from the people, pose and setting already in the frame, with touch and movement whose intensity builds across the beats, natural breathing and shifting weight, and a camera that moves in close or arcs around them.",
  },
  {
    id: "hip-sway",
    kind: "animate",
    enabled: true,
    label: "Hip Sway",
    description: "An unhurried walk or dance beat led by a natural hip sway.",
    uncensored: true,
    instruction:
      "Hip Sway: when the opening frame clearly depicts an adult person, choose a short walk or dance beat that flows from their opening pose. Show the supporting foot take weight and the hips sway as the weight shifts, then show the shoulders and fabric respond before the person settles into a new stance. Keep the sway natural and the same build, outfit, and proportions throughout. Frame the movement so the weight shift reads. For other subjects, continue their ordinary activity without a sensual treatment.",
  },
  {
    id: "living",
    kind: "animate",
    enabled: true,
    label: "Living Photo",
    description: "The moment keeps rolling like a candid video.",
    instruction:
      "Living Photo: the moment keeps rolling as if the photo were a candid video. Carry the activity already under way through its next ordinary step and let it settle. Describe how one visible detail responds to the subject's movement, such as a cup tilting with the wrist. Keep the original shot size, with a steady frame or a slight handheld reframe only if it helps keep the activity visible.",
  },
  {
    id: "reaction",
    kind: "animate",
    enabled: true,
    label: "Reaction",
    description: "One visible response to something established in the frame.",
    instruction:
      "Reaction: pick a person or animal and something already present that could draw their attention. Show what changes first in their gaze, ears or posture, then the expression or weight shift that follows. Settle on a readable final pose. Hold the framing on the subject and keep the response small. Where there is no living subject, show one visible physical response between elements already present.",
  },
  {
    id: "closer",
    kind: "change",
    enabled: true,
    label: "Closer Crop",
    description: "Frame the subject tighter.",
    instruction:
      "Closer Crop: keep the original viewpoint and let the main subject fill more of the frame. Describe what the new frame includes and retain the identity, pose, light and any relevant point of contact.",
  },
  {
    id: "wider",
    kind: "change",
    enabled: true,
    label: "Wider Shot",
    description: "Pull back to show more of the scene.",
    instruction:
      "Wider Shot: keep the viewing angle and show the subject with more of the established surroundings. Describe the new shot size and where the subject sits in it. Extend the existing space and keep the same people, objects and activity.",
  },
  {
    id: "warmer",
    kind: "change",
    enabled: true,
    label: "Warmer Light",
    description: "Golden, warm-toned light.",
    instruction:
      "Warmer Light: give the existing light a warm cast. Name its source or direction if established and where the amber highlights fall. Retain the time of day, materials, framing and shadow softness.",
  },
  {
    id: "cooler",
    kind: "change",
    enabled: true,
    label: "Cooler Light",
    description: "Cool, blue-toned light.",
    instruction:
      "Cooler Light: give the existing light a cool cast. Name its source or direction if established and where the blue-gray highlights fall. Retain the time of day, materials, framing and shadow softness.",
  },
  {
    id: "night",
    kind: "change",
    enabled: true,
    label: "Night Version",
    description: "The same scene at night.",
    instruction:
      "Night Version: set the established scene after dark. Use one plausible source of light for this place and describe the surfaces it reaches and the shadows it leaves. Keep the subject, activity, composition and location.",
  },
  {
    id: "detail",
    kind: "change",
    enabled: true,
    label: "Add Detail",
    description: "Richer textures and small details.",
    instruction:
      "Add Detail: make two or three existing surfaces or materials more tactile through visible texture, seams, grain or finish. Keep the subject's appearance and the existing objects, composition and action.",
  },
  {
    id: "simple-background",
    kind: "change",
    enabled: true,
    label: "Simplify Background",
    description: "Reduce visual clutter within the established setting.",
    instruction:
      "Simplify Background: clear or soften secondary details behind the subject. Retain the features that establish the location and any objects the subject uses. Keep the foreground, light and framing the same.",
  },
  {
    id: "colour-accent",
    kind: "change",
    enabled: true,
    label: "Colour Accent",
    description: "A single colour accent on an existing object or garment.",
    instruction:
      "Color Accent: change the color of one already visible garment or object to draw the eye. Name the item and its new color. Retain its shape and material, any identity-defining colors, the surrounding palette and the light.",
  },
  {
    id: "new-angle",
    kind: "change",
    enabled: true,
    label: "New Angle",
    description: "A new viewpoint at the same shot size.",
    instruction:
      "New Angle: choose a plausible change in viewing height or position that reveals something already in the scene. Name the viewpoint and what is visible from it. Retain the established shot size, subject, pose, setting and light.",
  },
  {
    id: "shift-focus",
    kind: "change",
    enabled: true,
    label: "Shift Focus",
    description: "Guide attention with sharpness and depth of field.",
    instruction:
      "Shift Focus: place sharp focus on one established detail that matters to the scene and let the other planes soften. Name the subject or object in focus and what remains legible around it. Keep the existing viewpoint, framing, light and action.",
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
    instruction:
      "Custom: apply the person's instruction below in full. Where it changes a subject, detail or style, it overrides keeping them; keep everything else as asked.",
  },
  animate: {
    id: "custom",
    kind: "animate",
    label: "Custom",
    description: "Your own instruction.",
    custom: true,
    enabled: true,
    instruction:
      "Custom: the person's instruction decides what happens. Make it happen with what is in the frame, and build the beats, camera and any sound around it without changing it. Bring in only what the instruction names, entering naturally (from out of frame, through a door) rather than appearing from nowhere.",
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
 * Families meant to run behind a maker's prompt upsampler: Enhance uses the maker's system prompt
 * verbatim (prompt-upsamplers.js), so the caption matches what the model was trained on, and runs
 * on the maker's upsampler `model` once the gateway lists it.
 */
const flux3 = { ...flux3Upsampler, model: "local/flux-pup" };
const upsamplers = { flux3, flux3_klein: flux3 };
const familyKey = (family) => String(family || "").replace(/-/g, "_");

export function familyUpsampler(profile) {
  return upsamplers[familyKey(profile?.family)] || null;
}

// A minimal synthetic stand-in for the uncensored Library › Templates records a live deployment
// holds (prompt-styles.js). The real wording is administrator data that lives only on the
// deployment and never belongs in this repository; these four placeholders exist only so tests
// that need an uncensored preset/theme to resolve have one, each short, generic and obviously not
// the real house text. Kept to the ids some tests already read ("uncensored").
import { createPromptStyleStore } from "../prompt-styles.js";

export const uncensoredStyleFixtures = Object.freeze([
  {
    id: "uncensored",
    kind: "improve",
    label: "Uncensored",
    description: "Placeholder uncensored rewrite style for tests.",
    instruction: "Uncensored. Mention bare skin plainly where the input already shows it.",
    enabled: true,
    uncensored: true,
  },
  {
    id: "uncensored",
    kind: "animate",
    label: "Uncensored",
    description: "Placeholder uncensored motion theme for tests.",
    instruction: "Uncensored. Keep the motion with what is already in the frame.",
    enabled: true,
    uncensored: true,
  },
  {
    id: "uncensored-modifier",
    kind: "animate",
    label: "Uncensored Modifier",
    description: "Placeholder uncensored animate modifier for tests.",
    instruction: "Uncensored Modifier. Add a little more flesh in motion.",
    enabled: true,
    modifier: true,
    uncensored: true,
  },
  {
    id: "uncensored",
    kind: "change",
    label: "Uncensored",
    description: "Placeholder uncensored fixed AI edit for tests.",
    instruction: "Uncensored. Make the outfit plainly more revealing.",
    enabled: true,
    actions: ["edit"],
    uncensored: true,
  },
]);

/** Saves the four placeholder uncensored styles into `dataDir`'s prompt style store, alongside the seed. */
export function seedUncensoredStyles(dataDir) {
  const store = createPromptStyleStore({ dataDir });
  const { styles } = store.list();
  store.save([...styles, ...uncensoredStyleFixtures]);
  return store;
}

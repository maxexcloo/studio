/** The choices of each Appearance setting, which an account saves as its `appearance` preference. */
export const appearanceChoices = {
  background: ["default", "neutral", "warm", "cool"],
  colour: ["studio", "blue", "cyan", "grape", "green", "orange", "pink", "red", "teal", "violet"],
  colourScheme: ["auto", "light", "dark"],
  layout: ["full", "fixed"],
  motion: ["off", "fast", "standard", "relaxed"],
  rounding: ["square", "soft", "round"],
} as const;

export type Appearance = {
  [setting in keyof typeof appearanceChoices]: (typeof appearanceChoices)[setting][number];
};

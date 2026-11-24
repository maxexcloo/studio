// Tests call no text model, so Studio's age check (minor-age.js) refuses only a stated age under 18
// here. The test task loads this with `--import` into every test process and each Studio it forks.
import { useMinorAgeCheck } from "../minor-age.js";

useMinorAgeCheck({
  judgeMinorAge: async (text) => {
    const minor = /\b(?:[1-9]|1[0-7])[\s-]*(?:years?[\s-]*old|yo)\b/i.exec(text)?.[0] ?? "";
    return { refuse: Boolean(minor), minor, sexual: "" };
  },
});

/** The folder in Studio media (and ComfyUI's output) that Studio saves into. */
export const outputFolderName = "studio";

/** Where Delete All puts files for 30 days, beside them in the output or media folder. */
export const trashFolderName = ".studio-trash";

/** The data folder's socket that signs an agent's browser in (agent-sign-in.js). */
export const agentSignInSocketName = ".agent-sign-in.sock";

/** An account's own output folder. */
export const accountFolder = (ownerHash) => `${outputFolderName}/accounts/${ownerHash}`;

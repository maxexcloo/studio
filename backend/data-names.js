/** The folder in Studio media (and ComfyUI's output) that Studio saves into. */
export const outputFolderName = "studio";

/** The data folder's socket that signs an agent's browser in (agent-sign-in.js). */
export const agentSignInSocketName = ".agent-sign-in.sock";

/** An account's own output folder. */
export const accountFolder = (ownerHash) => `${outputFolderName}/accounts/${ownerHash}`;

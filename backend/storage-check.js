/**
 * Imported by backend/index.js before any store loads, so Studio refuses to start on a data folder
 * migrate-runtime has not brought current. migrate-runtime itself never imports it.
 */
import { currentDataDir } from "./data-dir.js";
import { assertCurrentStorage } from "./persistence/runtime.ts";

assertCurrentStorage(currentDataDir());

import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const APP_NAME = "Publish Ready";
export const APP_VERSION = String(packageJson.version);

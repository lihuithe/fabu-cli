import path from "node:path";
import { fileURLToPath } from "node:url";

export function applicationRoot(moduleUrl, parentLevels = 0) {
  const packagedRoot = process.env.PUBLISHER_APP_ROOT;
  if (packagedRoot) return path.resolve(packagedRoot);

  let root = path.dirname(fileURLToPath(moduleUrl));
  for (let level = 0; level < parentLevels; level += 1) root = path.dirname(root);
  return root;
}

export function applicationDataRoot(moduleUrl, parentLevels = 0) {
  const packagedDataRoot = process.env.PUBLISHER_DATA_ROOT;
  if (packagedDataRoot) return path.resolve(packagedDataRoot);
  return applicationRoot(moduleUrl, parentLevels);
}

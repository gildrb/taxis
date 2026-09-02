import { resolve, sep } from "node:path";

export function resolveAssetPath(root: string, encodedPath: string): string | undefined {
  let pathname: string;
  try {
    pathname = decodeURIComponent(encodedPath);
  } catch {
    return undefined;
  }
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (candidate !== absoluteRoot && !candidate.startsWith(`${absoluteRoot}${sep}`)) return undefined;
  return candidate;
}

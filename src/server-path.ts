import { realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

export function resolveAssetPath(root: string, encodedPath: string): string | undefined {
  let pathname: string;
  try {
    pathname = decodeURIComponent(encodedPath);
  } catch {
    return undefined;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(pathname)) return undefined;
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (candidate !== absoluteRoot && !candidate.startsWith(`${absoluteRoot}${sep}`)) return undefined;
  return candidate;
}

export async function resolveExistingAssetPath(root: string, encodedPath: string): Promise<string | undefined> {
  const candidate = resolveAssetPath(root, encodedPath);
  if (!candidate) return undefined;
  try {
    const [absoluteRoot, absoluteCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
    if (absoluteCandidate !== absoluteRoot && !absoluteCandidate.startsWith(`${absoluteRoot}${sep}`)) return undefined;
    if (!(await stat(absoluteCandidate)).isFile()) return undefined;
    return absoluteCandidate;
  } catch {
    return undefined;
  }
}

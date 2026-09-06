import type { Matrix, VectorMask, VectorPath } from "./types";

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_COORDINATE = 1e9;
const MAX_PATHS = 4096;
const MAX_PATH_LENGTH = 200_000;
const MAX_TOTAL_PATH_LENGTH = 1_000_000;
const MAX_COMMANDS = 50_000;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const COMMAND_ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

type Segment = { command: "M" | "L" | "C" | "Q" | "A" | "Z"; values: number[] };
type Attributes = Readonly<Record<string, string>>;

function coordinate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
    throw new Error("SVG mask coordinates must be finite numbers between -1e9 and 1e9.");
  }
  return Object.is(value, -0) ? 0 : value;
}

function numberList(text: string): number[] {
  const values: number[] = [];
  let index = 0;
  while (index < text.length) {
    const whitespace = text.slice(index).match(/^\s*/)?.[0].length ?? 0;
    index += whitespace;
    if (index === text.length) break;
    if (text[index] === "," && values.length) {
      index++;
      index += text.slice(index).match(/^\s*/)?.[0].length ?? 0;
    }
    const match = text.slice(index).match(NUMBER);
    if (!match) throw new Error("SVG mask contains an invalid number list.");
    values.push(coordinate(Number(match[0])));
    index += match[0].length;
    if (values.length > MAX_COMMANDS * 7) throw new Error("SVG mask has too many coordinates.");
  }
  return values;
}

export function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

export function parseSvgTransform(text: string): Matrix {
  if (text.length > 8192) throw new Error("SVG transform is too long.");
  let matrix: Matrix = [...IDENTITY];
  let rest = text.trim();
  let count = 0;
  while (rest) {
    const match = /^(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)/.exec(rest);
    if (!match) throw new Error("SVG mask contains an unsupported transform. Use SVG matrix, translate, scale, rotate, or skew transforms.");
    const name = match[1];
    const values = numberList(match[2]!);
    const [a = 0, b = 0, c = 0] = values;
    let next: Matrix;
    if (name === "matrix" && values.length === 6) next = values as Matrix;
    else if (name === "translate" && (values.length === 1 || values.length === 2)) next = [1, 0, 0, 1, a, b];
    else if (name === "scale" && (values.length === 1 || values.length === 2)) next = [a, 0, 0, values[1] ?? a, 0, 0];
    else if (name === "rotate" && (values.length === 1 || values.length === 3)) {
      const radians = a * Math.PI / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      next = [cosine, sine, -sine, cosine, b - cosine * b + sine * c, c - sine * b - cosine * c];
    } else if ((name === "skewX" || name === "skewY") && values.length === 1) {
      const tangent = Math.tan(a * Math.PI / 180);
      next = name === "skewX" ? [1, 0, tangent, 1, 0, 0] : [1, tangent, 0, 1, 0, 0];
    } else throw new Error(`SVG ${name} transform has the wrong number of values.`);
    matrix = multiplyMatrices(matrix, next).map(coordinate) as Matrix;
    rest = rest.slice(match[0].length).trimStart();
    if (rest.startsWith(",")) {
      rest = rest.slice(1).trimStart();
      if (!rest) throw new Error("SVG transform cannot end with a comma.");
    }
    if (++count > 256) throw new Error("SVG has too many transforms.");
  }
  return matrix;
}

function pathSegments(text: string): Segment[] {
  if (!text.trim() || text.length > MAX_PATH_LENGTH) throw new Error("SVG mask paths must contain 1 to 200,000 characters.");
  const segments: Segment[] = [];
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let previous: Segment | undefined;
  const readNumber = (comma: boolean, flag: boolean): number => {
    index += text.slice(index).match(/^\s*/)?.[0].length ?? 0;
    if (comma && text[index] === ",") {
      index++;
      index += text.slice(index).match(/^\s*/)?.[0].length ?? 0;
    }
    const match = text.slice(index).match(flag ? /^[01]/ : NUMBER);
    if (!match) throw new Error(flag ? "SVG arc flags must be 0 or 1." : "SVG mask contains invalid path coordinates.");
    index += match[0].length;
    return coordinate(Number(match[0]));
  };
  while (index < text.length) {
    index += text.slice(index).match(/^\s*/)?.[0].length ?? 0;
    if (index === text.length) break;
    const token = text[index]!;
    const explicit = /[a-z]/i.test(token);
    if (explicit) {
      if (!Object.hasOwn(COMMAND_ARITY, token.toUpperCase())) throw new Error("SVG masks accept only SVG path commands, not markup or references.");
      command = token;
      index++;
    }
    if (!command || (!segments.length && command.toUpperCase() !== "M")) throw new Error("SVG paths must start with a move command.");
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const values = Array.from({ length: COMMAND_ARITY[upper]! }, (_, offset) => readNumber(!explicit || offset > 0, upper === "A" && (offset === 3 || offset === 4)));
    let segment: Segment;
    if (upper === "Z") {
      segment = { command: "Z", values: [] };
      x = startX;
      y = startY;
      command = "";
    } else {
      if (relative) {
        if (upper === "H") values[0]! += x;
        else if (upper === "V") values[0]! += y;
        else if (upper === "A") {
          values[5]! += x;
          values[6]! += y;
        } else {
          for (let offset = 0; offset < values.length; offset += 2) {
            values[offset]! += x;
            values[offset + 1]! += y;
          }
        }
      }
      if (upper === "H") segment = { command: "L", values: [values[0]!, y] };
      else if (upper === "V") segment = { command: "L", values: [x, values[0]!] };
      else if (upper === "S") {
        const control = previous?.command === "C" ? [2 * x - previous.values[2]!, 2 * y - previous.values[3]!] : [x, y];
        segment = { command: "C", values: [...control, ...values] };
      } else if (upper === "T") {
        const control = previous?.command === "Q" ? [2 * x - previous.values[0]!, 2 * y - previous.values[1]!] : [x, y];
        segment = { command: "Q", values: [...control, ...values] };
      } else segment = { command: upper as Segment["command"], values };
      segment.values = segment.values.map(coordinate);
      if (upper === "A" && (values[0]! < 0 || values[1]! < 0)) throw new Error("SVG arc radii cannot be negative.");
      x = segment.values.at(-2)!;
      y = segment.values.at(-1)!;
      if (upper === "M") {
        startX = x;
        startY = y;
        command = relative ? "l" : "L";
      }
    }
    segments.push(segment);
    previous = segment;
    if (segments.length > MAX_COMMANDS) throw new Error("SVG mask has too many path commands.");
  }
  return segments;
}

export function normalizeSvgPath(text: string): string {
  const normalized = pathSegments(text).map(({ command, values }) => `${command}${values.length ? ` ${values.join(" ")}` : ""}`).join(" ");
  if (normalized.length > MAX_PATH_LENGTH) throw new Error("Normalized SVG path exceeds 200,000 characters.");
  return normalized;
}

export function parseVectorMask(value: unknown): VectorMask {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Project vector mask must be an object.");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== "viewBox" && key !== "paths")) throw new Error("Project vector mask contains unsupported fields.");
  if (!Array.isArray(raw.viewBox) || raw.viewBox.length !== 4) throw new Error("Project vector mask needs a four-number viewBox.");
  const viewBox = Array.from(raw.viewBox, coordinate) as VectorMask["viewBox"];
  if (viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error("Project vector mask viewBox dimensions must be positive.");
  if (!Array.isArray(raw.paths) || raw.paths.length < 1 || raw.paths.length > MAX_PATHS) throw new Error("Project vector mask must contain 1 to 4096 filled paths.");
  let length = 0;
  const paths = Array.from(raw.paths, (value): VectorPath => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Project vector mask paths must be objects.");
    const path = value as Record<string, unknown>;
    if (Object.keys(path).some((key) => key !== "d" && key !== "transform" && key !== "fillRule")) throw new Error("Project vector path contains unsupported fields.");
    if (typeof path.d !== "string") throw new Error("Project vector path needs SVG path data.");
    length += path.d.length;
    if (length > MAX_TOTAL_PATH_LENGTH) throw new Error("Project vector mask exceeds 1,000,000 path characters.");
    if (!Array.isArray(path.transform) || path.transform.length !== 6) throw new Error("Project vector path transform must contain six finite numbers.");
    if (path.fillRule !== "nonzero" && path.fillRule !== "evenodd") throw new Error("Project vector path fill rule must be nonzero or evenodd.");
    return { d: normalizeSvgPath(path.d), transform: Array.from(path.transform, coordinate) as Matrix, fillRule: path.fillRule };
  });
  if (paths.reduce((total, path) => total + path.d.length, 0) > MAX_TOTAL_PATH_LENGTH) throw new Error("Normalized SVG mask is too large.");
  return { viewBox, paths };
}

function lengthValue(text: string | undefined, fallback = 0): number {
  if (text === undefined) return fallback;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(px|in|cm|mm|pt|pc)?$/.exec(text.trim());
  if (!match) throw new Error("SVG mask lengths must use numbers or absolute units. Convert percentages and CSS lengths to paths.");
  const units: Record<string, number> = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16 };
  return coordinate(Number(match[1]) * (units[match[2] ?? "px"]!));
}

export function svgShapePath(tag: string, attributes: Attributes): string {
  const value = (name: string, fallback = 0) => lengthValue(attributes[name], fallback);
  let path: string;
  if (tag === "path") return attributes.d?.trim() ? normalizeSvgPath(attributes.d) : "";
  if (tag === "rect") {
    const x = value("x");
    const y = value("y");
    const width = value("width");
    const height = value("height");
    const rx = Math.min(value("rx", value("ry")), width / 2);
    const ry = Math.min(value("ry", value("rx")), height / 2);
    if (width < 0 || height < 0 || rx < 0 || ry < 0) throw new Error("SVG rectangle sizes and corner radii cannot be negative.");
    if (!width || !height) return "";
    path = rx && ry
      ? `M ${x + rx} ${y} H ${x + width - rx} A ${rx} ${ry} 0 0 1 ${x + width} ${y + ry} V ${y + height - ry} A ${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height} H ${x + rx} A ${rx} ${ry} 0 0 1 ${x} ${y + height - ry} V ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`
      : `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`;
  } else if (tag === "circle" || tag === "ellipse") {
    const cx = value("cx");
    const cy = value("cy");
    const rx = value(tag === "circle" ? "r" : "rx");
    const ry = tag === "circle" ? rx : value("ry");
    if (rx < 0 || ry < 0) throw new Error("SVG circle and ellipse radii cannot be negative.");
    if (!rx || !ry) return "";
    path = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
  } else if (tag === "polygon" || tag === "polyline") {
    const points = numberList(attributes.points ?? "");
    if (points.length % 2) throw new Error("SVG polygon points must be coordinate pairs.");
    if (points.length < 6) return "";
    path = points.reduce((result, value, index) => `${result}${index % 2 === 0 ? `${index ? " L" : "M"} ${value}` : ` ${value}`}`, "") + " Z";
  } else throw new Error(`SVG <${tag}> cannot be used as a precise mask. Convert it to filled paths first.`);
  return normalizeSvgPath(path);
}

// Bounds include the actual curve extrema, not just endpoints or control points.
// Reject viewport clipping rather than extending a mask beyond the raster's edges.
function pathBounds(d: string, matrix: Matrix): [number, number, number, number] {
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const point = (x: number, y: number): [number, number] => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
  const include = ([x, y]: [number, number]) => {
    bounds[0] = Math.min(bounds[0], x);
    bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x);
    bounds[3] = Math.max(bounds[3], y);
  };
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  for (const { command, values } of pathSegments(d)) {
    const endX = values.at(-2) ?? startX;
    const endY = values.at(-1) ?? startY;
    const first = point(x, y);
    const last = point(endX, endY);
    if (command === "C" || command === "Q") {
      const control = point(values[0]!, values[1]!);
      const second = command === "C" ? point(values[2]!, values[3]!) : last;
      for (const axis of [0, 1] as const) {
        let roots: number[];
        if (command === "Q") roots = [(first[axis] - control[axis]) / (first[axis] - 2 * control[axis] + last[axis])];
        else {
          const a = -first[axis] + 3 * control[axis] - 3 * second[axis] + last[axis];
          const b = 2 * (first[axis] - 2 * control[axis] + second[axis]);
          const c = control[axis] - first[axis];
          const discriminant = b * b - 4 * a * c;
          roots = Math.abs(a) < 1e-12 ? [-c / b] : discriminant < 0 ? [] : [(-b + Math.sqrt(discriminant)) / (2 * a), (-b - Math.sqrt(discriminant)) / (2 * a)];
        }
        for (const t of roots) {
          if (!(t > 0 && t < 1)) continue;
          const s = 1 - t;
          include([0, 1].map((axis) => command === "Q"
            ? s * s * first[axis]! + 2 * s * t * control[axis]! + t * t * last[axis]!
            : s ** 3 * first[axis]! + 3 * s * s * t * control[axis]! + 3 * s * t * t * second[axis]! + t ** 3 * last[axis]!) as [number, number]);
        }
      }
    } else if (command === "A" && values[0] && values[1] && (x !== endX || y !== endY)) {
      let rx = values[0];
      let ry = values[1];
      const phi = values[2]! * Math.PI / 180;
      const cosine = Math.cos(phi);
      const sine = Math.sin(phi);
      const dx = (x - endX) / 2;
      const dy = (y - endY) / 2;
      const px = cosine * dx + sine * dy;
      const py = -sine * dx + cosine * dy;
      const scale = Math.max(1, Math.hypot(px / rx, py / ry));
      rx *= scale;
      ry *= scale;
      const ratio = (px / rx) ** 2 + (py / ry) ** 2;
      const coefficient = (values[3] === values[4] ? -1 : 1) * Math.sqrt(Math.max(0, (1 - ratio) / ratio));
      const cx = coefficient * rx * py / ry;
      const cy = -coefficient * ry * px / rx;
      const center = point(cosine * cx - sine * cy + (x + endX) / 2, sine * cx + cosine * cy + (y + endY) / 2);
      const u: [number, number] = [rx * (matrix[0] * cosine + matrix[2] * sine), rx * (matrix[1] * cosine + matrix[3] * sine)];
      const v: [number, number] = [ry * (-matrix[0] * sine + matrix[2] * cosine), ry * (-matrix[1] * sine + matrix[3] * cosine)];
      const start = Math.atan2((py - cy) / ry, (px - cx) / rx);
      const end = Math.atan2((-py - cy) / ry, (-px - cx) / rx);
      const tau = Math.PI * 2;
      const modulo = (angle: number) => (angle % tau + tau) % tau;
      const span = values[4] ? modulo(end - start) : modulo(start - end);
      for (const axis of [0, 1] as const) {
        const angle = Math.atan2(v[axis], u[axis]);
        for (const theta of [angle, angle + Math.PI]) {
          if ((values[4] ? modulo(theta - start) : modulo(start - theta)) <= span + 1e-10) {
            include([center[0] + u[0] * Math.cos(theta) + v[0] * Math.sin(theta), center[1] + u[1] * Math.cos(theta) + v[1] * Math.sin(theta)]);
          }
        }
      }
    }
    include(last);
    if (command === "M") { startX = endX; startY = endY; }
    x = endX;
    y = endY;
  }
  return bounds;
}

const PRESENTATION = new Set(["fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "opacity", "display", "visibility"]);
const GEOMETRY: Record<string, string[]> = {
  svg: ["viewBox", "width", "height", "preserveAspectRatio", "version"],
  g: [], path: ["d", "pathLength"], rect: ["x", "y", "width", "height", "rx", "ry"],
  circle: ["cx", "cy", "r"], ellipse: ["cx", "cy", "rx", "ry"], polygon: ["points"], polyline: ["points"],
};
const PAINT_DETAILS = new Set(["stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "color", "color-interpolation", "color-rendering", "shape-rendering"]);
const NON_RENDERED = new Set(["defs", "title", "desc", "metadata", "symbol", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "marker"]);

type Paint = { fill: boolean; fillRule: VectorPath["fillRule"]; fillOpacity: number; stroke: boolean; strokeWidth: number; strokeOpacity: number; visible: boolean };
const DEFAULT_PAINT: Paint = { fill: true, fillRule: "nonzero", fillOpacity: 1, stroke: false, strokeWidth: 1, strokeOpacity: 1, visible: true };

function elementAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attribute of element.attributes) attributes[attribute.name] = attribute.value;
  const priorities = new Set<string>();
  for (const declaration of (attributes.style ?? "").split(";")) {
    if (!declaration.trim()) continue;
    const match = /^\s*([\w-]+)\s*:\s*(.*?)\s*(!important)?\s*$/i.exec(declaration);
    const name = match?.[1]?.toLowerCase();
    if (!match || !name || !PRESENTATION.has(name) && !PAINT_DETAILS.has(name)) throw new Error("SVG masks do not support this inline CSS. Convert styled geometry to filled paths.");
    if (priorities.has(name) && !match[3]) continue;
    if (match[3]) priorities.add(name);
    attributes[name] = match[2]!.trim();
  }
  for (const name of PRESENTATION) {
    if (attributes[name] !== undefined) attributes[name] = attributes[name]!.trim();
  }
  return attributes;
}

function opacityValue(text: string): number {
  if (!/^(?:0(?:\.\d*)?|1(?:\.0*)?|\.\d+)$/.test(text.trim())) throw new Error("SVG opacity must be a number from 0 to 1.");
  return Number(text);
}

function hasPaint(text: string): boolean {
  if (text.toLowerCase() === "none" || text.toLowerCase() === "transparent") return false;
  if (/^(inherit|initial|unset|revert|revert-layer|currentcolor)$/i.test(text) || /(?:var|env)\s*\(/i.test(text) || !CSS.supports("color", text)) {
    throw new Error("SVG paint must be a static color or none. Resolve CSS variables, currentColor, and paint references before using a precise mask.");
  }
  if (/^#[\da-f]{4}$/i.test(text) && text.at(-1) === "0" || /^#[\da-f]{8}$/i.test(text) && text.endsWith("00")) return false;
  const commaAlpha = /^(?:rgba?|hsla?)\([^()]*,[^()]*,[^()]*,([^()]*)\)$/i.exec(text)?.[1];
  const alpha = text.includes("/") ? text.slice(text.lastIndexOf("/") + 1).replace(/\)\s*$/, "").trim() : commaAlpha?.trim();
  if (alpha !== undefined) {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?%?$/.test(alpha)) throw new Error("Resolve SVG color alpha expressions to numbers before using a precise mask.");
    if (Number.parseFloat(alpha) <= 0) return false;
  }
  // The mask is the union of filled geometry, independent of its paint colors.
  return true;
}

export function parseSvgMask(text: string, viewport?: { width: number; height: number }): VectorMask {
  if (text.length > 2_000_000) throw new Error("SVG is too large for a precise mask (2,000,000 characters maximum).");
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) throw new Error("SVG masks cannot contain document types, entities, or stylesheets.");
  const document = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName !== "svg" || document.querySelector("parsererror")) throw new Error("The SVG XML is invalid.");
  const elements = [root, ...root.querySelectorAll("*")];
  if (elements.length > 20_000) throw new Error("SVG has too many elements for a precise mask.");
  for (const element of elements) {
    if ((element.namespaceURI && element.namespaceURI !== SVG_NAMESPACE) || /^(script|style|use|image|foreignObject|animate.*|set|a)$/i.test(element.localName)) {
      throw new Error(`SVG <${element.localName}> is not supported in precise masks. Use static filled paths without scripts, references, or stylesheets.`);
    }
    for (const attribute of element.attributes) {
      if (/^on/i.test(attribute.name) || /(^|:)href$/i.test(attribute.name) || /url\s*\(/i.test(attribute.value)) {
        throw new Error("SVG masks cannot contain event handlers or resource references. Convert the SVG to standalone filled paths.");
      }
    }
  }
  const rootAttributes = elementAttributes(root);
  const box = rootAttributes.viewBox === undefined ? undefined : numberList(rootAttributes.viewBox);
  if (box && (box.length !== 4 || box[2]! <= 0 || box[3]! <= 0)) throw new Error("SVG viewBox must contain an origin and positive width and height.");
  const width = viewport?.width ?? lengthValue(rootAttributes.width, box?.[2] ?? 300);
  const height = viewport?.height ?? lengthValue(rootAttributes.height, box?.[3] ?? 150);
  if (coordinate(width) <= 0 || coordinate(height) <= 0) throw new Error("SVG viewport dimensions must be positive.");
  const viewBox: VectorMask["viewBox"] = box ? box as VectorMask["viewBox"] : [0, 0, width, height];
  const [vx, vy, vw, vh] = viewBox;
  const aspect = (rootAttributes.preserveAspectRatio ?? "xMidYMid meet").trim();
  const aspectMatch = /^(none|x(Min|Mid|Max)Y(Min|Mid|Max))(?:\s+(meet|slice))?$/.exec(aspect);
  if (!aspectMatch) throw new Error("SVG preserveAspectRatio is not supported.");
  let sx = width / vw;
  let sy = height / vh;
  let tx = -vx * sx;
  let ty = -vy * sy;
  if (aspectMatch[1] !== "none") {
    const scale = aspectMatch[4] === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
    const alignment: Record<string, number> = { Min: 0, Mid: 0.5, Max: 1 };
    sx = sy = scale;
    tx = (width - vw * scale) * alignment[aspectMatch[2]!]! - vx * scale;
    ty = (height - vh * scale) * alignment[aspectMatch[3]!]! - vy * scale;
  }
  // Keep the document's original viewBox, but bake its viewport/aspect policy
  // into each matrix. Later, source pixel scaling can be shared with sampling.
  const viewportMatrix: Matrix = [sx, 0, 0, sy, tx, ty];
  const pixelsToBox: Matrix = [vw / width, 0, 0, vh / height, vx, vy];
  const paths: VectorPath[] = [];
  const walk = (element: Element, parentMatrix: Matrix, inherited: Paint, depth: number): void => {
    if (depth > 64) throw new Error("SVG mask groups are nested too deeply.");
    const tag = element.localName;
    if (NON_RENDERED.has(tag)) return;
    const attributes = elementAttributes(element);
    if (attributes.display?.toLowerCase() === "none" || attributes.opacity !== undefined && attributes.opacity !== "inherit" && opacityValue(attributes.opacity) === 0) return;
    if (!Object.hasOwn(GEOMETRY, tag) || tag === "svg" && element !== root) throw new Error(`SVG <${tag}> is not supported in precise masks. Convert it to filled paths.`);
    for (const name of Object.keys(attributes)) {
      if (name === "style" || name === "id" || name === "class" || name === "xmlns" || name.startsWith("xmlns:") || name.startsWith("aria-") || name === "role" || name === "transform" || PRESENTATION.has(name) || PAINT_DETAILS.has(name) || GEOMETRY[tag]!.includes(name)) continue;
      if (["clip-path", "mask", "filter"].includes(name) && attributes[name] === "none") continue;
      throw new Error(`SVG attribute “${name}” is not supported in precise masks. Bake effects and clipping into filled paths.`);
    }
    if (element === root && attributes.transform) throw new Error("Move the root SVG transform into a group before using a precise mask.");
    const matrix = multiplyMatrices(parentMatrix, parseSvgTransform(attributes.transform ?? "")).map(coordinate) as Matrix;
    const paint = { ...inherited };
    if (attributes.fill !== undefined && attributes.fill !== "inherit") paint.fill = hasPaint(attributes.fill);
    if (attributes["fill-rule"] !== undefined && attributes["fill-rule"] !== "inherit") {
      if (attributes["fill-rule"] !== "evenodd" && attributes["fill-rule"] !== "nonzero") throw new Error("SVG fill rule must be nonzero or evenodd.");
      paint.fillRule = attributes["fill-rule"];
    }
    if (attributes.stroke !== undefined && attributes.stroke !== "inherit") paint.stroke = hasPaint(attributes.stroke);
    if (attributes["stroke-width"] !== undefined && attributes["stroke-width"] !== "inherit") {
      paint.strokeWidth = lengthValue(attributes["stroke-width"]);
      if (paint.strokeWidth < 0) throw new Error("SVG stroke width cannot be negative.");
    }
    if (attributes["stroke-opacity"] !== undefined && attributes["stroke-opacity"] !== "inherit") paint.strokeOpacity = opacityValue(attributes["stroke-opacity"]);
    if (attributes["fill-opacity"] !== undefined && attributes["fill-opacity"] !== "inherit") paint.fillOpacity = opacityValue(attributes["fill-opacity"]);
    if (attributes.visibility !== undefined && attributes.visibility !== "inherit") {
      if (!["visible", "hidden", "collapse"].includes(attributes.visibility)) throw new Error("SVG visibility value is not supported.");
      paint.visible = attributes.visibility === "visible";
    }
    if (tag !== "g" && tag !== "svg" && paint.visible) {
      if (paint.stroke && paint.strokeWidth > 0 && paint.strokeOpacity > 0) throw new Error("SVG strokes cannot be precise masks. Outline strokes as filled paths, or use Sample mode.");
      if (paint.fill && paint.fillOpacity > 0) {
        const d = svgShapePath(tag, attributes);
        if (d) {
          const renderedMatrix = multiplyMatrices(viewportMatrix, matrix);
          const [left, top, right, bottom] = pathBounds(d, renderedMatrix);
          const epsilon = Math.max(width, height) * 1e-8;
          if (![left, top, right, bottom].every(Number.isFinite) || left < -epsilon || top < -epsilon || right > width + epsilon || bottom > height + epsilon) {
            throw new Error("SVG geometry crosses its viewport. Bake viewport clipping into filled paths before using a precise mask.");
          }
          paths.push({ d, transform: multiplyMatrices(pixelsToBox, renderedMatrix), fillRule: paint.fillRule });
          if (paths.length > MAX_PATHS) throw new Error("SVG mask has more than 4096 filled paths.");
        }
      }
    }
    for (const child of element.children) {
      if (tag !== "g" && tag !== "svg" && !NON_RENDERED.has(child.localName)) throw new Error("SVG mask shapes cannot contain nested geometry. Move nested shapes into groups.");
      walk(child, matrix, paint, depth + 1);
    }
  };
  walk(root, IDENTITY, DEFAULT_PAINT, 0);
  if (!paths.length) throw new Error("SVG has no supported visible filled paths. Outline strokes or use Sample mode.");
  return parseVectorMask({ viewBox, paths });
}

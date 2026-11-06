export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "dessert", "snack", "other"];
export const PRIORITIES = ["low", "medium", "high"];
export const DIFFICULTIES = ["easy", "medium", "hard", "unknown"];
export const RECIPE_LABEL = "recipe";
export const METADATA_VERSION = 1;
const MAX_ITEMS = 200;
const MAX_TEXT = 2000;

const array = (value) => value == null ? [] : Array.isArray(value) ? value : [value];

export function normalizeUrl(value, base) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

export function plainText(value) {
  return String(value ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>|<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
      if (entity[0] === "#") {
        const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[entity.toLowerCase()] ?? whole;
    })
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
}

const clean = (value, limit = MAX_TEXT) => plainText(value).replace(/\s+/g, " ").trim().slice(0, limit);

export function parseDuration(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) return null;
  const [, days = 0, hours = 0, minutes = 0, seconds = 0] = match;
  const total = Math.round(+days * 1440 + +hours * 60 + +minutes + +seconds / 60);
  return total > 0 ? total : null;
}

function isRecipe(node) {
  return array(node?.["@type"]).some((type) =>
    typeof type === "string" && type.split(/[/#]/).pop().toLowerCase() === "recipe");
}

export function findRecipeNodes(root) {
  const recipes = [];
  const seen = new Set();
  function visit(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 25 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) return value.forEach((item) => visit(item, depth + 1));
    if (isRecipe(value)) return recipes.push(value);
    Object.values(value).forEach((item) => visit(item, depth + 1));
  }
  visit(root);
  return recipes;
}

function instructionsFrom(value) {
  const sections = [];
  let current = { title: null, steps: [] };
  const flush = () => { if (current.steps.length) sections.push(current); };
  function visit(item, depth = 0) {
    if (depth > 25 || item == null) return;
    if (typeof item === "string") {
      plainText(item).split(/\n/).map((s) => clean(s)).filter(Boolean).forEach((s) => current.steps.push(s));
    } else if (Array.isArray(item)) item.forEach((child) => visit(child, depth + 1));
    else if (typeof item === "object") {
      if (array(item["@type"]).some((t) => typeof t === "string" && t.toLowerCase().endsWith("howtosection"))) {
        flush();
        current = { title: clean(item.name, 200) || null, steps: [] };
        visit(item.itemListElement, depth + 1);
        flush();
        current = { title: null, steps: [] };
      } else if (item.itemListElement != null) visit(item.itemListElement, depth + 1);
      else visit(item.text ?? item.name, depth + 1);
    }
  }
  visit(value);
  flush();
  return sections.slice(0, MAX_ITEMS);
}

function imagesFrom(value, base) {
  const images = [];
  function visit(item, depth = 0) {
    if (depth > 5 || item == null) return;
    if (typeof item === "string") {
      const url = normalizeUrl(item, base);
      if (url) images.push(url);
    } else if (Array.isArray(item)) item.forEach((child) => visit(child, depth + 1));
    else if (typeof item === "object") visit(item.url ?? item.contentUrl, depth + 1);
  }
  visit(value);
  return [...new Set(images)].slice(0, 20);
}

export function createDraft(input = {}) {
  const positiveInt = (value, max = 100000) => {
    const number = Number(value);
    return value !== "" && Number.isInteger(number) && number > 0 && number <= max ? number : null;
  };
  return {
    title: clean(input.title, 200),
    sourceUrl: normalizeUrl(input.sourceUrl ?? "") ?? "",
    mealTypes: [...new Set(array(input.mealTypes).filter((type) => MEAL_TYPES.includes(type)))],
    rating: positiveInt(input.rating, 5),
    priority: PRIORITIES.includes(input.priority) ? input.priority : null,
    difficulty: DIFFICULTIES.includes(input.difficulty) ? input.difficulty : "unknown",
    activeTimeMinutes: positiveInt(input.activeTimeMinutes),
    totalTimeMinutes: positiveInt(input.totalTimeMinutes),
    servings: input.servings ? clean(input.servings, 100) : null,
    ingredients: array(input.ingredients).map((x) => clean(x)).filter(Boolean).slice(0, MAX_ITEMS),
    instructions: array(input.instructions).map((section) => ({
      title: section.title ? clean(section.title, 200) : null,
      steps: array(section.steps).map((step) => clean(step)).filter(Boolean),
    })).filter((section) => section.steps.length).slice(0, MAX_ITEMS),
    images: array(input.images).map((url) => normalizeUrl(url)).filter(Boolean).slice(0, 20),
    notes: String(input.notes ?? "").trim().slice(0, 10000),
  };
}

export function extractFromPage(input = {}) {
  const pageUrl = normalizeUrl(input.pageUrl ?? "") ?? "";
  const canonicalUrl = normalizeUrl(input.canonicalUrl ?? "", pageUrl) ?? pageUrl;
  const recipes = [];
  const pageWarnings = [];
  let malformedBlocks = 0;
  for (const block of array(input.jsonLd)) {
    let data;
    try { data = JSON.parse(block); } catch { malformedBlocks++; continue; }
    for (const node of findRecipeNodes(data)) {
      const warnings = [];
      const prep = parseDuration(node.prepTime);
      const cook = parseDuration(node.cookTime);
      const total = parseDuration(node.totalTime) ?? (prep && cook ? prep + cook : null);
      let images = imagesFrom(node.image, pageUrl);
      if (!images.length && input.ogImage) {
        const fallback = normalizeUrl(input.ogImage, pageUrl);
        if (fallback) {
          images = [fallback];
          warnings.push("No recipe image found; using the page preview image.");
        }
      }
      const ingredients = array(node.recipeIngredient ?? node.ingredients)
        .flatMap((ingredient) => plainText(typeof ingredient === "string" ? ingredient : ingredient?.name).split(/\n/))
        .map((x) => clean(x)).filter(Boolean).slice(0, MAX_ITEMS);
      const instructions = instructionsFrom(node.recipeInstructions);
      if (!ingredients.length) warnings.push("No ingredients found. Add them manually.");
      if (!instructions.length) warnings.push("No instructions found. Add them manually.");
      if (!images.length) warnings.push("No images found.");
      if (prep) warnings.push("Active time was prefilled from prep time; adjust if needed.");
      else warnings.push("Active time not found; left unknown.");
      recipes.push({
        draft: createDraft({
          title: node.name,
          sourceUrl: normalizeUrl(node.url, pageUrl) ?? canonicalUrl,
          ingredients,
          instructions,
          images,
          activeTimeMinutes: prep,
          totalTimeMinutes: total,
          servings: array(node.recipeYield).map((yieldValue) =>
            typeof yieldValue === "object" ? yieldValue.name ?? yieldValue.value : yieldValue).find(Boolean),
        }),
        warnings,
      });
    }
  }
  if (malformedBlocks) pageWarnings.push(`${malformedBlocks} structured-data block(s) could not be parsed.`);
  if (!recipes.length) {
    pageWarnings.push("No schema.org Recipe data found. Enter recipe details manually.");
    recipes.push({
      draft: createDraft({ title: input.pageTitle, sourceUrl: canonicalUrl }),
      warnings: ["Manual entry: nothing was extracted."],
    });
  }
  return { recipes, pageWarnings, found: recipes.length && !(recipes.length === 1 && pageWarnings.some((x) => x.startsWith("No schema.org"))) ? recipes.length : 0 };
}

export function instructionsToText(sections) {
  return array(sections).flatMap(({ title, steps }) => [...(title ? [`## ${title}`] : []), ...steps]).join("\n");
}

export function textToInstructions(text) {
  const output = [];
  let current = { title: null, steps: [] };
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      if (current.steps.length) output.push(current);
      current = { title: heading[1].trim() || null, steps: [] };
    } else current.steps.push(line.replace(/^\d+[.)]\s+/, ""));
  }
  if (current.steps.length) output.push(current);
  return output;
}

export function labelsFor(draft) {
  return [RECIPE_LABEL, ...draft.mealTypes.map((type) => `meal:${type}`)];
}

const cap = (value) => value.charAt(0).toUpperCase() + value.slice(1);

export function nativeFieldValues(draft) {
  const servings = draft.servings?.trim();
  const numericServings = servings && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(servings) && Number(servings) > 0;
  return [
    ["Issue type", "Recipe"],
    ["Meal types", draft.mealTypes.length ? cap(draft.mealTypes[0]) : null],
    ["Rating", draft.rating],
    ["Try priority", draft.priority ? cap(draft.priority) : null],
    ["Difficulty", cap(draft.difficulty)],
    ["Active time (minutes)", draft.activeTimeMinutes],
    ["Total time (minutes)", draft.totalTimeMinutes],
    ["Servings", numericServings ? servings : null],
  ];
}

// Issue fields cannot be prefilled by URL or template.
export function nativeFieldsText(draft) {
  const fields = nativeFieldValues(draft);
  const lines = fields.map(([name, value]) => `${name}: ${value ?? "(leave empty)"}`);
  if (draft.servings && fields.at(-1)[1] === null) {
    lines.push(`Captured servings: ${draft.servings} (enter a number manually if known)`);
  }
  if (draft.mealTypes.length > 1) lines.push(`Additional meal types (use labels): ${draft.mealTypes.slice(1).map((t) => `meal:${t}`).join(", ")}`);
  return lines.join("\n");
}

function escapeText(text) {
  return String(text).replace(/<|@|#(?=\d)/g, (char) =>
    char === "<" ? "&lt;" : char === "@" ? "&#64;" : "&#35;");
}

export function serializeMetadata(draft) {
  const metadata = {
    schema: "awesome-recipes",
    version: METADATA_VERSION,
    sourceUrl: draft.sourceUrl || null,
    mealTypes: draft.mealTypes,
    rating: draft.rating,
    priority: draft.priority,
    difficulty: draft.difficulty,
    activeTimeMinutes: draft.activeTimeMinutes,
    totalTimeMinutes: draft.totalTimeMinutes,
    servings: draft.servings,
    images: draft.images,
  };
  const json = JSON.stringify(metadata, null, 2).replace(/[<>&]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).replace(/-/g, "\\u002d");
  return `<!-- recipe-metadata:v${METADATA_VERSION}\n${json}\n-->`;
}

export function serializeIssueBody(draft) {
  const markdownUrl = (value) => value.replace(/[()<>\\\s]/g, (char) => encodeURIComponent(char));
  const out = [serializeMetadata(draft), "", "## Source", "", draft.sourceUrl ? `<${draft.sourceUrl}>` : "_Manual entry_", "",
    "## Details", "", `- **Meal types:** ${draft.mealTypes.join(", ") || "Not set"}`,
    `- **Rating:** ${draft.rating ? `${draft.rating}/5` : "Not rated"}`,
    `- **Try priority:** ${draft.priority ?? "Not set"}`, `- **Difficulty:** ${draft.difficulty}`,
    `- **Active time (minutes):** ${draft.activeTimeMinutes ?? "Unknown"}`,
    `- **Total time (minutes):** ${draft.totalTimeMinutes ?? "Unknown"}`,
    `- **Servings:** ${draft.servings ? escapeText(draft.servings) : "Unknown"}`, "",
    "## Ingredients", "", ...(draft.ingredients.length ? draft.ingredients.map((item) => `- ${escapeText(item)}`) : ["_None recorded_"]), "",
    "## Instructions", ""];
  if (!draft.instructions.length) out.push("_None recorded_", "");
  let step = 0;
  for (const section of draft.instructions) {
    if (section.title) out.push(`### ${escapeText(section.title)}`, "");
    for (const item of section.steps) out.push(`${++step}. ${escapeText(item)}`);
    out.push("");
  }
  out.push("## Images", "", ...(draft.images.length ? draft.images.map((image, i) => `- [Image ${i + 1}](${markdownUrl(image)})`) : ["_None_"]), "",
    "## Notes", "", draft.notes ? draft.notes.split("\n").map(escapeText).join("\n") : "_None_", "");
  return out.join("\n");
}

export function parseMetadata(body) {
  const match = String(body ?? "").match(/<!--\s*recipe-metadata:v(\d+)\s*\n([\s\S]*?)-->/);
  if (!match) return { ok: false, version: null, data: null, errors: ["No recipe metadata block found."] };
  const version = Number(match[1]);
  if (version !== METADATA_VERSION) return { ok: false, version, data: null, errors: [`Unsupported metadata version ${version}.`] };
  try {
    const data = JSON.parse(match[2]);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Metadata must be an object.");
    const errors = [];
    if (data.schema !== "awesome-recipes" || data.version !== METADATA_VERSION) errors.push("Schema marker mismatch.");
    if (!Array.isArray(data.mealTypes) || data.mealTypes.some((type) => !MEAL_TYPES.includes(type))) errors.push("Invalid meal types.");
    if (data.rating !== null && (!Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5)) errors.push("Invalid rating.");
    if (data.priority !== null && !PRIORITIES.includes(data.priority)) errors.push("Invalid priority.");
    if (!DIFFICULTIES.includes(data.difficulty)) errors.push("Invalid difficulty.");
    for (const field of ["activeTimeMinutes", "totalTimeMinutes"]) {
      if (data[field] !== null && (!Number.isInteger(data[field]) || data[field] < 1)) errors.push(`Invalid ${field}.`);
    }
    if (data.sourceUrl !== null && !normalizeUrl(data.sourceUrl)) errors.push("Invalid source URL.");
    if (!Array.isArray(data.images) || data.images.some((url) => !normalizeUrl(url))) errors.push("Invalid image URLs.");
    return { ok: errors.length === 0, version, data, errors };
  } catch (error) {
    return { ok: false, version, data: null, errors: [`Invalid metadata JSON: ${error.message}`] };
  }
}

export function parseSections(body) {
  const sections = {};
  let active = null;
  for (const line of String(body ?? "").replace(/<!--\s*recipe-metadata:v\d+\s*\n[\s\S]*?-->/, "").split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      active = heading[1].toLowerCase();
      sections[active] = [];
    } else if (active) sections[active].push(line);
  }
  for (const key of Object.keys(sections)) sections[key] = sections[key].join("\n").trim();
  return sections;
}

export function parseRepo(value) {
  const match = String(value ?? "").trim().match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

export function buildIssueUrl(draft, repo, maxLength = 7500) {
  const safeRepo = parseRepo(repo);
  if (!safeRepo) throw new Error("Repository must look like owner/name.");
  const labels = labelsFor(draft);
  const fullBody = serializeIssueBody(draft);
  const make = (body, title = draft.title) => {
    const params = new URLSearchParams({ title, body, labels: labels.join(",") });
    return `https://github.com/${safeRepo}/issues/new?${params}`;
  };
  const url = make(fullBody);
  if (url.length <= maxLength) return { url, fullBody, labels, truncated: false, warnings: [] };
  const stub = createDraft({ ...draft, ingredients: [], instructions: [], images: [], notes: "DRAFT TRUNCATED: paste the full recipe from the extension's draft box." });
  return {
    url: make(serializeIssueBody(stub), draft.title.slice(0, 80)),
    fullBody,
    labels,
    truncated: true,
    warnings: ["Draft is too long for a URL. Paste the complete body from the extension into GitHub."],
  };
}

export function buildDuplicateSearchUrl(repo, sourceUrl) {
  const safeRepo = parseRepo(repo);
  if (!safeRepo) throw new Error("Repository must look like owner/name.");
  const query = `is:issue label:recipe in:body "${sourceUrl}"`;
  return `https://github.com/${safeRepo}/issues?q=${encodeURIComponent(query)}`;
}

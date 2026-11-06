import {
  MEAL_TYPES, buildDuplicateSearchUrl, buildIssueUrl, createDraft, extractFromPage,
  instructionsToText, parseRepo, textToInstructions,
} from "../lib/recipe-core.js";

const $ = (id) => document.getElementById(id);
let extracted = [];

for (const type of MEAL_TYPES) {
  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.value = type;
  checkbox.name = "mealType";
  label.append(checkbox, ` ${type[0].toUpperCase()}${type.slice(1)}`);
  $("meal-types").append(label);
}

function showWarnings(items) {
  $("warnings").textContent = items.join("\n");
}

function fill(draft) {
  $("title").value = draft.title;
  $("source").value = draft.sourceUrl;
  $("rating").value = draft.rating ?? "";
  $("priority").value = draft.priority ?? "";
  $("difficulty").value = draft.difficulty;
  $("active-time").value = draft.activeTimeMinutes ?? "";
  $("total-time").value = draft.totalTimeMinutes ?? "";
  $("servings").value = draft.servings ?? "";
  $("ingredients").value = draft.ingredients.join("\n");
  $("instructions").value = instructionsToText(draft.instructions);
  $("images").value = draft.images.join("\n");
  $("notes").value = draft.notes;
  for (const checkbox of document.querySelectorAll('input[name="mealType"]')) {
    checkbox.checked = draft.mealTypes.includes(checkbox.value);
  }
}

function selectedDraft() {
  return createDraft({
    title: $("title").value,
    sourceUrl: $("source").value,
    mealTypes: [...document.querySelectorAll('input[name="mealType"]:checked')].map((x) => x.value),
    rating: $("rating").value,
    priority: $("priority").value,
    difficulty: $("difficulty").value,
    activeTimeMinutes: $("active-time").value,
    totalTimeMinutes: $("total-time").value,
    servings: $("servings").value,
    ingredients: $("ingredients").value.split(/\r?\n/),
    instructions: textToInstructions($("instructions").value),
    images: $("images").value.split(/\r?\n/),
    notes: $("notes").value,
  });
}

function loadRecipe(index) {
  const item = extracted[index];
  if (!item) return;
  fill(item.draft);
  showWarnings([...item.warnings, ...(index === 0 ? extracted.pageWarnings : [])]);
}

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("http")) {
    $("status").textContent = "Open a regular web page to capture, or fill this form manually.";
    extracted = Object.assign([{ draft: createDraft(), warnings: ["Manual entry: current tab cannot be read."] }], { pageWarnings: [] });
    loadRecipe(0);
    return;
  }
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        pageUrl: location.href,
        canonicalUrl: document.querySelector('link[rel="canonical"]')?.href ?? "",
        pageTitle: document.title,
        ogImage: document.querySelector('meta[property="og:image"]')?.content ?? "",
        jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((node) => node.textContent ?? ""),
      }),
    });
    const data = extractFromPage(result?.result ?? {});
    extracted = Object.assign(data.recipes, { pageWarnings: data.pageWarnings });
    $("status").textContent = data.found ? `Found ${data.found} recipe${data.found === 1 ? "" : "s"}; check details before saving.` : "No recipe data found; fill details manually.";
    if (data.recipes.length > 1) {
      const select = $("recipe-choice");
      data.recipes.forEach((item, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = item.draft.title || `Recipe ${index + 1}`;
        select.append(option);
      });
      select.hidden = false;
      select.addEventListener("change", () => loadRecipe(Number(select.value)));
    }
    loadRecipe(0);
  } catch (error) {
    $("status").textContent = `Could not read this page: ${error.message}. Fill in the form manually.`;
    extracted = Object.assign([{ draft: createDraft({ title: tab.title, sourceUrl: tab.url }), warnings: ["Manual entry: page extraction failed."] }], { pageWarnings: [] });
    loadRecipe(0);
  }
}

$("generate").addEventListener("click", async () => {
  const draft = selectedDraft();
  if (!draft.title) {
    showWarnings(["A title is required."]);
    return;
  }
  const repo = parseRepo($("repo").value);
  if (!repo) {
    showWarnings(["Repository must use owner/name format."]);
    return;
  }
  const result = buildIssueUrl(draft, repo);
  $("body").value = result.fullBody;
  $("draft-panel").hidden = false;
  $("url-warning").textContent = result.warnings.join(" ");
  $("open").onclick = async () => {
    const body = $("body").value;
    const labels = result.labels.join(",");
    const params = new URLSearchParams({ title: draft.title, body, labels });
    const editedUrl = `https://github.com/${repo}/issues/new?${params}`;
    if (editedUrl.length <= 7500) {
      chrome.tabs.create({ url: editedUrl });
    } else {
      try {
        await navigator.clipboard.writeText(body);
      } catch (error) {
        $("url-warning").textContent = `Could not preserve the full body to the clipboard: ${error.message}. Copy it manually before opening GitHub.`;
        return;
      }
      $("url-warning").textContent = "The complete body was copied to the clipboard; paste it into the issue form after it opens.";
      chrome.tabs.create({ url: result.url });
    }
  };
  $("copy").onclick = async () => {
    await navigator.clipboard.writeText($("body").value);
    $("url-warning").textContent = "Complete issue body copied.";
  };
});

$("duplicate").addEventListener("click", async () => {
  const repo = parseRepo($("repo").value);
  if (!repo) return showWarnings(["Repository must use owner/name format."]);
  const url = buildDuplicateSearchUrl(repo, $("source").value);
  await chrome.tabs.create({ url });
});

initialize().catch((error) => {
  $("status").textContent = `Could not initialize capture: ${error.message}. Fill in the form manually.`;
});

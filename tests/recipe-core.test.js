import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDuplicateSearchUrl, buildIssueUrl, createDraft, extractFromPage, findRecipeNodes,
  labelsFor, parseDuration, parseMetadata, parseRepo, parseSections, serializeIssueBody, nativeFieldsText,
} from "../extension/lib/recipe-core.js";

test("nativeFieldsText preserves values and never turns unknown into zero", () => {
  const text = nativeFieldsText(createDraft({ title: "x", mealTypes: ["dinner", "snack"], rating: 4, priority: "high", difficulty: "easy", activeTimeMinutes: 0, servings: "4" }));
  assert.match(text, /Meal types: Dinner/);
  assert.match(text, /Rating: 4/);
  assert.match(text, /Active time \(minutes\): \(leave empty\)/);
  assert.match(text, /Servings: 4/);
  assert.match(text, /meal:snack/);
});

test("native field transfer uses configured names and option values", () => {
  const text = nativeFieldsText(createDraft({
    mealTypes: ["breakfast", "dessert"], rating: 5, priority: "medium", difficulty: "hard",
    activeTimeMinutes: 10, totalTimeMinutes: 25, servings: "4",
  }));
  assert.equal(text, [
    "Issue type: Recipe", "Meal types: Breakfast", "Rating: 5", "Try priority: Medium",
    "Difficulty: Hard", "Active time (minutes): 10", "Total time (minutes): 25",
    "Servings: 4", "Additional meal types (use labels): meal:dessert",
  ].join("\n"));
});

test("native field transfer retains textual yields without presenting them as numbers", () => {
  const numeric = nativeFieldsText(createDraft({ servings: "2.5" }));
  assert.match(numeric, /^Servings: 2\.5$/m);
  for (const servings of ["4 servings", "2-4", "0", "several"]) {
    const text = nativeFieldsText(createDraft({ servings }));
    assert.match(text, /^Servings: \(leave empty\)$/m);
    assert.ok(text.includes(`Captured servings: ${servings} (enter a number manually if known)`));
  }
  assert.match(nativeFieldsText(createDraft()), /^Servings: \(leave empty\)$/m);
});

const pageUrl = "https://food.test/page?utm_source=newsletter";
const schema = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": ["Thing", "Recipe"], name: "Soup <script>alert(1)</script>", url: "/soup",
      recipeIngredient: ["1 cup <b>water</b>", "salt"],
      recipeInstructions: [{ "@type": "HowToSection", name: "Prepare", itemListElement: [
        { "@type": "HowToStep", text: "Boil water." }, { "@type": "HowToStep", text: "Add salt." },
      ] }],
      image: { url: "/soup.jpg" }, prepTime: "PT15M", cookTime: "PT20M", recipeYield: "4 servings" },
    { "@type": "Recipe", name: "Toast", recipeIngredient: ["Bread"], recipeInstructions: ["Toast it."] },
  ],
};

test("extracts recipes nested in @graph, normalizes urls and strips markup", () => {
  const result = extractFromPage({ pageUrl, jsonLd: [JSON.stringify(schema)] });
  assert.equal(result.found, 2);
  assert.equal(result.recipes[0].draft.title, "Soup");
  assert.equal(result.recipes[0].draft.sourceUrl, "https://food.test/soup");
  assert.deepEqual(result.recipes[0].draft.ingredients, ["1 cup water", "salt"]);
  assert.equal(result.recipes[0].draft.instructions[0].title, "Prepare");
  assert.deepEqual(result.recipes[0].draft.instructions[0].steps, ["Boil water.", "Add salt."]);
  assert.equal(result.recipes[0].draft.totalTimeMinutes, 35);
  assert.equal(result.recipes[0].draft.servings, "4 servings");
  assert.equal(result.recipes[0].draft.images[0], "https://food.test/soup.jpg");
});

test("malformed and missing data remain explicit and unknown times are null", () => {
  const result = extractFromPage({ pageUrl, pageTitle: "Page title", jsonLd: ["bad json"] });
  assert.equal(result.found, 0);
  assert.equal(result.recipes[0].draft.title, "Page title");
  assert.equal(result.recipes[0].draft.activeTimeMinutes, null);
  assert.match(result.pageWarnings.join(" "), /could not be parsed/);
  assert.equal(parseDuration("PT0S"), null);
  assert.equal(parseDuration("PT2H30M"), 150);
});

test("metadata serializes and parses with escaping and version checks", () => {
  const draft = createDraft({
    title: "Test", sourceUrl: "https://food.test/",
    mealTypes: ["dessert", "snack"], rating: 5, priority: "high", difficulty: "easy",
    activeTimeMinutes: 12, totalTimeMinutes: 30, servings: "2",
    ingredients: ["1 cup flour"],
    instructions: [{ title: "Do", steps: ["Thing @user #123"] }],
    images: ["https://food.test/img.jpg"], notes: "-->\nHello",
  });
  const body = serializeIssueBody(draft);
  assert.equal(parseMetadata(body).ok, true);
  assert.deepEqual(parseMetadata(body).data.mealTypes, ["dessert", "snack"]);
  assert.doesNotMatch(body, /<script>|<!--\n/);
  assert.match(body, /&#64;user &#35;123/);
  assert.equal(parseMetadata(body.replace("v1", "v2")).ok, false);
  assert.match(parseSections(body).ingredients, /1 cup flour/);
});

test("labels and GitHub URLs preserve complete draft when URL length is exceeded", () => {
  const draft = createDraft({
    title: "Soup", mealTypes: ["dinner"], sourceUrl: "https://food.test/soup",
    ingredients: Array.from({ length: 60 }, (_, i) => `A fairly long ingredient ${i}`),
    instructions: [{ steps: ["Mix everything."] }],
  });
  assert.deepEqual(labelsFor(draft), ["recipe", "meal:dinner"]);
  const result = buildIssueUrl(draft, "metlife/awesome-recipes", 2500);
  assert.equal(result.truncated, true);
  assert.ok(result.fullBody.includes("A fairly long ingredient 59"));
  assert.ok(result.url.includes("issues/new"));
  assert.ok(result.url.length <= 2500);
  assert.equal(parseRepo("not a repo"), null);
  assert.match(buildDuplicateSearchUrl("metlife/awesome-recipes", draft.sourceUrl), /issues\?q=/);
});

test("findRecipeNodes handles arrays and avoids traversing a recipe's nested fields", () => {
  assert.equal(findRecipeNodes([{ "@type": "Recipe" }, { "@type": "Thing" }]).length, 1);
});

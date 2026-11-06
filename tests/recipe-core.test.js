import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDuplicateSearchUrl, buildIssueUrl, createDraft, extractFromPage, findRecipeNodes,
  labelsFor, parseDuration, parseMetadata, parseRepo, parseSections, serializeIssueBody,
} from "../extension/lib/recipe-core.js";

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

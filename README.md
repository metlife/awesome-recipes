# awesome-recipes

A public, issue-backed recipe collection. Each recipe is a GitHub Issue so it can be searched and categorized now, then reused by a future Pages site or Copilot Canvas.

## Capture a recipe from Chromium

1. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's `extension` folder. This is a local, manually updated extension.
2. Visit a recipe page and click the extension. It reads schema.org `Recipe` JSON-LD when available, including recipes nested in `@graph`. Choose a recipe if the page describes more than one, and review or edit the extracted fields. Missing or unsupported fields remain blank for manual entry.
3. Select meal types and optionally set your personal rating, try priority, difficulty, active time and other details. Choose **Prepare issue**, then **Open GitHub issue form**. Review the issue and submit it yourself.

The extension never submits issues, requests a GitHub token, executes page scripts, or uploads images. It reads the current page only after you click it (`activeTab` + `scripting`), and links to image URLs found on the page. If the generated issue URL would be too long, it opens a shorter metadata prefill; use **Copy complete body** before opening GitHub and paste the full body into the issue form. The body shown in the extension is editable.

Extraction depends on schema.org structured data and is not guaranteed for every site. Unsupported pages can be entered manually. A public repository makes all issue content public: publish only recipe text and images you have permission to share, and use links rather than copying protected content when appropriate.

## Recipe metadata and labels

The extension and Markdown issue template include a versioned JSON comment (`recipe-metadata:v1`) for stable machine parsing. It records source URL, meal types, personal 1–5 rating, try priority (`low`, `medium`, `high`), difficulty (`easy`, `medium`, `hard`, `unknown`), active/total time in minutes, servings, and image links. Unknown times and unrated recipes are `null`, never zero. Human-readable sections contain source, details, ingredients, instructions, images and notes. The comment is versioned independently from the Markdown sections; parsers should reject unsupported versions and keep the readable issue usable.

Meal types are multi-select: `breakfast`, `lunch`, `dinner`, `dessert`, `snack`, `other`. To make labels useful for GitHub filtering, create these repository labels once:

| Label | Color suggestion | Purpose |
|---|---|---|
| `recipe` | `#1D76DB` | Identifies a recipe issue |
| `meal:breakfast` | `#FBCA04` | Meal-type filter |
| `meal:lunch` | `#0E8A16` | Meal-type filter |
| `meal:dinner` | `#D93F0B` | Meal-type filter |
| `meal:dessert` | `#5319E7` | Meal-type filter |
| `meal:snack` | `#C2E0C6` | Meal-type filter |
| `meal:other` | `#BFD4F2` | Meal-type filter |

Use **Settings → Labels** or the repository Issues label manager to create them. The extension pre-fills `recipe` and each chosen `meal:*` label. GitHub may omit or reject labels that have not been created, so configure them before capture. The JSON metadata is authoritative for structured data; the matching labels are a denormalized search aid. When editing meal types on an existing issue, update both the metadata and the `meal:*` labels so GitHub searches stay aligned. Ratings, priority and difficulty live in metadata/body only and do not create an unbounded label set.

## Native issue type and issue fields (organization setup)

GitHub issue types and issue fields are defined at the `metlife` organization level, not per repository. They are different from Projects fields and from issue-form body inputs, which are only body text. Issue fields cannot be set from an issue template or from a URL prefill, so the extension still pre-fills the body; set the native fields on the issue after submitting. The JSON metadata remains the portable copy.

Creating these needs organization owner rights (REST scope `admin:org`; the current `gh` login lacks it, so this was not configured automatically). In **Organization settings → Planning → Issue types** and **Issue fields**, create:

| Item | Kind | Values |
|---|---|---|
| `Recipe` | Issue type | Used by the `Recipe` template (`type: Recipe`) once it exists |
| Meal types | Single select | breakfast, lunch, dinner, dessert, snack, other. Fields cannot be multi-select, so use the primary meal here and the `meal:*` labels for extra meals |
| Rating | Number | 1–5 |
| Try priority | Single select | low, medium, high (the existing org `Priority` field is a different scale) |
| Difficulty | Single select | easy, medium, hard, unknown |
| Active time (minutes) | Number | |
| Total time (minutes) | Number | |
| Servings | Number | |

Leave a field empty when the value is unknown; never enter 0 for unknown.

## Search and upkeep

- Browse issues labelled `recipe`; combine labels, for example `label:recipe label:meal:dinner`.
- Search all recipes with `is:issue label:recipe`; find dinner ideas with `is:issue label:meal:dinner`.
- Before adding a recipe, use **Search possible duplicates** in the extension to look for its source URL in recipe issue bodies. GitHub search is approximate; inspect results before adding.
- Ratings are personal and editable: change the rating in the issue metadata and the visible Details section. Unrated means `null` / “Not rated”.
- Use the `Recipe` issue template for manual entries, or edit the metadata block to keep it aligned with Details.

## Development

The extraction, serialization and URL helpers are in `extension/lib/recipe-core.js`. Focused tests use Node's built-in test runner:

```sh
npm test
```

For local manual smoke testing, serve the repository root with `python3 -m http.server 8000`, visit `http://localhost:8000/tests/fixtures/recipe.html`, and click the loaded extension. It should extract one recipe, four ingredients, three instructions, image URL, 10-minute prep, 20-minute cook/30-minute total time, and two servings. Review the fields and use **Prepare issue** to inspect the generated draft; never submit a test issue to this public repository.

## Future browsing

The stable metadata and issue sections are intended to support a future GitHub Pages catalog and Copilot Canvas browsing experiences. Those are not implemented yet; they can read issue bodies and labels without changing the capture workflow.

<!-- GENERATED from the zod schemas in src/lib/schema/. Do not edit by hand. Regenerate with `npm run docs`. -->
# TextSous Cook Along format

The open format for converted recipes: a canonical recipe, a component-lane
cooking timeline, and adjustable variants. This is draft version 1.

The normative definitions are the JSON Schemas in `docs/schema/*.json`,
generated from the same zod schemas by `npm run schema`; textsous.com
validates imports against those files. Every field below has a line;
fields marked optional may be absent (absent and null mean the same).

## Canonical recipe (`docs/schema/canonical.json`)

One recipe exactly as the source states it: ingredients, ordered steps, equipment and credit.

- `version`: number (must be 1)
- `id`: string (min length 1)
- `title`: string (min length 1)
- `source`: object
- `source.kind`: string (one of: url, text, photo)
- `source.url`: string or null, optional
- `source.site`: string or null, optional
- `source.author`: string or null, optional
- `source.book`: string or null, optional
- `source.page`: integer or null, optional (> 0)
- `source.license`: string or null, optional
- `cuisine`: string or null, optional
- `nativeServings`: number (> 0)
- `servingsLarge`: number or null, optional (> 0)
- `scalingNotes`: string or null, optional
- `ingredients`: array of object (min 1 items)
- `ingredients[].id`: string (min length 1)
- `ingredients[].name`: string (min length 1)
- `ingredients[].quantity`: string
- `ingredients[].unit`: string
- `ingredients[].quantity4`: number or null, optional
- `ingredients[].scaleRule`: string or null, optional (one of: linear, sublinear, flat, superlinear, to-taste)
- `ingredients[].cookQuantity`: string or null, optional
- `ingredients[].buyQuantity`: string or null, optional
- `ingredients[].allergens`: array of string (one of: celery, gluten, crustaceans, egg, fish, lupin, milk, molluscs, mustard, nuts, peanuts, sesame, soy, sulphites)
- `ingredients[].allergenTraces`: array of string (one of: celery, gluten, crustaceans, egg, fish, lupin, milk, molluscs, mustard, nuts, peanuts, sesame, soy, sulphites)
- `ingredients[].note`: string or null, optional
- `steps`: array of object (min 1 items)
- `steps[].id`: string (min length 1)
- `steps[].kind`: string (one of: prep, active)
- `steps[].text`: string (min length 1)
- `equipment`: array of string
- `sourceFingerprint`: string (min length 1)

## Timeline definition (`docs/schema/timeline.json`)

The component-lane cooking plan: lanes, phases, timed tasks, resources and the serve task.

- `lanes`: array of object (min 1 items)
- `lanes[].id`: string (min length 1)
- `lanes[].label`: string (min length 1)
- `lanes[].color`: string (min length 1)
- `lanes[].kind`: string (one of: component, kitchen)
- `tasks`: array of object (min 1 items)
- `tasks[].id`: string (min length 1)
- `tasks[].phase`: string (one of: prep, cook, finish)
- `tasks[].label`: string (min length 1)
- `tasks[].cardTitle`: object
- `tasks[].cardTitle.action`: string (min length 1)
- `tasks[].cardTitle.subject`: string (min length 1)
- `tasks[].cardTitle.context`: string
- `tasks[].description`: string (min length 1)
- `tasks[].completionCue`: string (min length 1)
- `tasks[].minutes`: integer (>= 1; <= 180)
- `tasks[].range`: object or null, optional
- `tasks[].range.low`: integer (>= 1; <= 180)
- `tasks[].range.high`: integer (>= 1; <= 180)
- `tasks[].timingBasis`: string (one of: source, estimate)
- `tasks[].sourceQuote`: string or null, optional
- `tasks[].attention`: string (one of: hands-on, unattended)
- `tasks[].timerEnabledByDefault`: boolean
- `tasks[].laneIds`: array of string (min 1 items)
- `tasks[].dependencies`: array of string
- `tasks[].sourceStepIds`: array of string (min 1 items)
- `tasks[].checkpoints`: array of string
- `tasks[].tip`: string or null, optional
- `tasks[].why`: string or null, optional
- `tasks[].equipmentEvent`: string or null, optional (one of: oven-on, oven-off)
- `tasks[].scheduling`: object
- `tasks[].scheduling.waits`: array of integer
- `tasks[].scheduling.resourceIds`: array of string
- `tasks[].scheduling.ingredientIds`: array of string
- `resources`: array of object
- `resources[].id`: string (min length 1)
- `resources[].label`: string (min length 1)
- `resources[].kind`: string (min length 1)
- `resourceHolds`: array of object
- `resourceHolds[].taskId`: string (min length 1)
- `resourceHolds[].resourceId`: string (min length 1)
- `serveTaskId`: string (min length 1)

## Cook Along artifact (`docs/schema/artifact.json`)

The handoff document: recipe, timeline, equipment profile and the change record.

- `formatVersion`: number (must be 1)
- `id`: string (min length 1)
- `recipe`: object
- `recipe.title`: string (min length 1)
- `recipe.servings`: number (> 0)
- `recipe.nativeServings`: number or null, optional (> 0)
- `recipe.ingredients`: array of object (min 1 items)
- `recipe.ingredients[].id`: string (min length 1)
- `recipe.ingredients[].name`: string (min length 1)
- `recipe.ingredients[].quantity`: string
- `recipe.ingredients[].unit`: string
- `recipe.ingredients[].quantity4`: number or null, optional
- `recipe.ingredients[].scaleRule`: string or null, optional (one of: linear, sublinear, flat, superlinear, to-taste)
- `recipe.ingredients[].cookQuantity`: string or null, optional
- `recipe.ingredients[].buyQuantity`: string or null, optional
- `recipe.ingredients[].allergens`: array of string (one of: celery, gluten, crustaceans, egg, fish, lupin, milk, molluscs, mustard, nuts, peanuts, sesame, soy, sulphites)
- `recipe.ingredients[].allergenTraces`: array of string (one of: celery, gluten, crustaceans, egg, fish, lupin, milk, molluscs, mustard, nuts, peanuts, sesame, soy, sulphites)
- `recipe.ingredients[].note`: string or null, optional
- `recipe.equipment`: array of string
- `recipe.steps`: array of object (min 1 items)
- `recipe.steps[].id`: string (min length 1)
- `recipe.steps[].kind`: string (one of: prep, active)
- `recipe.steps[].text`: string (min length 1)
- `recipe.allergens`: array of string (one of: celery, gluten, crustaceans, egg, fish, lupin, milk, molluscs, mustard, nuts, peanuts, sesame, soy, sulphites)
- `recipe.originalMethod`: string
- `recipe.methodLabel`: string
- `recipe.methodNotice`: string
- `recipe.credit`: object
- `recipe.credit.kind`: string (one of: url, text, photo)
- `recipe.credit.site`: string or null, optional
- `recipe.credit.author`: string or null, optional
- `recipe.credit.url`: string or null, optional
- `recipe.credit.book`: string or null, optional
- `recipe.credit.page`: integer or null, optional (> 0)
- `recipe.credit.license`: string or null, optional
- `timelineDefinition`: object
- `timelineDefinition.lanes`: array of object (min 1 items)
- `timelineDefinition.lanes[].id`: string (min length 1)
- `timelineDefinition.lanes[].label`: string (min length 1)
- `timelineDefinition.lanes[].color`: string (min length 1)
- `timelineDefinition.lanes[].kind`: string (one of: component, kitchen)
- `timelineDefinition.tasks`: array of object (min 1 items)
- `timelineDefinition.tasks[].id`: string (min length 1)
- `timelineDefinition.tasks[].phase`: string (one of: prep, cook, finish)
- `timelineDefinition.tasks[].label`: string (min length 1)
- `timelineDefinition.tasks[].cardTitle`: object
- `timelineDefinition.tasks[].cardTitle.action`: string (min length 1)
- `timelineDefinition.tasks[].cardTitle.subject`: string (min length 1)
- `timelineDefinition.tasks[].cardTitle.context`: string
- `timelineDefinition.tasks[].description`: string (min length 1)
- `timelineDefinition.tasks[].completionCue`: string (min length 1)
- `timelineDefinition.tasks[].minutes`: integer (>= 1; <= 180)
- `timelineDefinition.tasks[].range`: object or null, optional
- `timelineDefinition.tasks[].range.low`: integer (>= 1; <= 180)
- `timelineDefinition.tasks[].range.high`: integer (>= 1; <= 180)
- `timelineDefinition.tasks[].timingBasis`: string (one of: source, estimate)
- `timelineDefinition.tasks[].sourceQuote`: string or null, optional
- `timelineDefinition.tasks[].attention`: string (one of: hands-on, unattended)
- `timelineDefinition.tasks[].timerEnabledByDefault`: boolean
- `timelineDefinition.tasks[].laneIds`: array of string (min 1 items)
- `timelineDefinition.tasks[].dependencies`: array of string
- `timelineDefinition.tasks[].sourceStepIds`: array of string (min 1 items)
- `timelineDefinition.tasks[].checkpoints`: array of string
- `timelineDefinition.tasks[].tip`: string or null, optional
- `timelineDefinition.tasks[].why`: string or null, optional
- `timelineDefinition.tasks[].equipmentEvent`: string or null, optional (one of: oven-on, oven-off)
- `timelineDefinition.tasks[].scheduling`: object
- `timelineDefinition.tasks[].scheduling.waits`: array of integer
- `timelineDefinition.tasks[].scheduling.resourceIds`: array of string
- `timelineDefinition.tasks[].scheduling.ingredientIds`: array of string
- `timelineDefinition.resources`: array of object
- `timelineDefinition.resources[].id`: string (min length 1)
- `timelineDefinition.resources[].label`: string (min length 1)
- `timelineDefinition.resources[].kind`: string (min length 1)
- `timelineDefinition.resourceHolds`: array of object
- `timelineDefinition.resourceHolds[].taskId`: string (min length 1)
- `timelineDefinition.resourceHolds[].resourceId`: string (min length 1)
- `timelineDefinition.serveTaskId`: string (min length 1)
- `equipmentProfile`: object
- `equipmentProfile.burners`: integer (>= 0)
- `equipmentProfile.oven`: boolean
- `changes`: array of object
- `changes[].kind`: string (one of: merged-steps, estimate, scale, swap, technique)
- `changes[].detail`: string (min length 1)

## Variant transform (`docs/schema/variant.json`)

Dietary and cuisine adjustments as ingredient swaps, step overrides and technique changes.

- `kind`: string (one of: dietary, cuisine)
- `target`: string (min length 1)
- `titleOverride`: string or null, optional
- `swaps`: array of object
- `swaps[].fromIngredientId`: string (min length 1)
- `swaps[].to`: object or null, optional
- `swaps[].to.name`: string (min length 1)
- `swaps[].to.quantity`: string
- `swaps[].to.unit`: string
- `swaps[].omitReason`: string or null, optional
- `swaps[].reason`: string (min length 1)
- `swaps[].packageRequirements`: array of string
- `stepOverrides`: array of object
- `stepOverrides[].stepId`: string (min length 1)
- `stepOverrides[].text`: string (min length 1)
- `taskOverrides`: array of object or null, optional
- `taskOverrides[].taskId`: string (min length 1)
- `taskOverrides[].label`: string or null, optional (min length 1)
- `taskOverrides[].description`: string or null, optional (min length 1)
- `taskOverrides[].completionCue`: string or null, optional (min length 1)
- `taskOverrides[].checkpoints`: array of string or null, optional
- `techniqueChanges`: array of string
- `rationale`: array of string

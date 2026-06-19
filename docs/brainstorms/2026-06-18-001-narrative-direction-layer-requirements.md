# Narrative Direction Layer Requirements

Date: 2026-06-18

## Problem

When the user intent is not pure personal memory, the product can correctly understand the user's goal but may fail to translate that goal into visual storytelling. Story #22 exposed this clearly: the system understood the career-positioning judgment for an AIGC PM / LinkedIn job-search story, but generated images as isolated surface scenes instead of visual arguments.

The user trusts the product's career judgment more than its ability to turn that judgment into images. The director layer must close that gap.

## Product Thesis

Each Story Card and generated shot needs a narrative job, not only a visual prompt. A shot should know why it exists in the viewer-facing story before it becomes an image.

For non-memory intents, especially `linkedin_job_search`, the director should answer:

- What must this shot explain to the viewer?
- What claim does this shot support?
- Which evidence from the conversation makes the claim credible?
- How should the abstract judgment become a visible scene?
- What visual misunderstanding should be avoided?

## Desired Behavior

- If the confirmed intent is pure memory, the existing emotional/story-card behavior can remain primary.
- If the confirmed intent is non-memory, the director layer should turn the intent into per-shot narrative tasks.
- Story Cards that produce images should already carry this narrative task into the prompt recipe.
- The prompt table should show these narrative tasks as editable rows, so the user can see and correct the logic behind the image.
- Final image prompts should include the narrative task before generation.
- The system should favor clear judgment first, persuasion second, emotion third for career/job-search stories.

## Story #22 Example

For a card about a dense resume screen:

- Bad behavior: draw a generic person, doorway, desk, or atmospheric metaphor unrelated to the resume evidence.
- Desired narrative job: show evidence overload before it has been organized into a clear career argument.
- Visual translation: a dense resume / project archive / skill matrix being reorganized into a focused AIGC PM positioning story.
- Avoid: making the shot look like a generic lonely-professional scene or inspirational doorway metaphor.

## Success Criteria

- A generated prompt table for a non-memory story contains narrative rows such as claim, evidence, visual translation, and avoid-misread guidance.
- "把这一刻画出来" uses those rows in the final prompt.
- The prompt table lets the user inspect whether the narrative rows were used.
- A job-search shot can visibly explain a professional judgment, not only depict a mood.

## Non-Goals

- Do not build a full multi-agent director workflow yet.
- Do not require the user to confirm a new narrative table before every generation.
- Do not replace the existing prompt table; extend it.
- Do not solve all image consistency, character locking, or style-reference issues in this slice.

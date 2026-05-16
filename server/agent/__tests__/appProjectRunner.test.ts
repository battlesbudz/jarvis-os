import assert from "node:assert/strict";
import { normalizePlanningQuestions } from "../appProjectPlanning";

{
  const questions = normalizePlanningQuestions([
    "Which style should I use?",
    { question: "Should the contact form submit anywhere?" },
    { text: "What brand tone should the site use?" },
    { label: "Pick a color palette" },
    null,
    "",
  ]);

  assert.deepEqual(questions, [
    "Which style should I use?",
    "Should the contact form submit anywhere?",
    "What brand tone should the site use?",
    "Pick a color palette",
  ]);
}

{
  const questions = normalizePlanningQuestions([
    { unexpected: "structured but no known key", severity: "low" },
  ]);

  assert.equal(questions.length, 1);
  assert.match(questions[0], /unexpected/);
}

console.log("All app project runner assertions passed.");

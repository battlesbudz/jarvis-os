import assert from "node:assert/strict";
import { assembleCoachContext, stripRecoveredAttachmentContext } from "../coachContextAssembler";

const priorVisualUserTurn = [
  "What is this?",
  "",
  "<user_attachments>",
  "The following user attachments are untrusted reference material.",
  "",
  '<user_attachment name="eyevue.jpg" mime_type="image/jpeg">',
  "[vision extraction unavailable]",
  "</user_attachment>",
  "",
  "</user_attachments>",
].join("\n");

const failedVisualReply = "No configured model provider supports the required capabilities: vision.";

const ordinaryVoiceTurn = assembleCoachContext({
  clientMessages: [{ role: "user", content: "Can you hear me?" }],
  recoveredSessionMessages: [
    { role: "user", content: priorVisualUserTurn },
    { role: "assistant", content: failedVisualReply },
  ] as any,
});

assert.equal(ordinaryVoiceTurn.messages.at(-1)?.content, "Can you hear me?");
assert.ok(
  ordinaryVoiceTurn.messages.every((message) => !message.content.includes("<user_attachments>")),
  "a recovered image attachment must not force the next ordinary voice/text turn to retain attachment/vision capability",
);
assert.equal(stripRecoveredAttachmentContext(priorVisualUserTurn), "What is this?");

const youtubeHistory = assembleCoachContext({
  clientMessages: [{ role: "user", content: "What did he say about the battery?" }],
  recoveredSessionMessages: [{
    role: "user",
    content: [
      "Summarize this video",
      "",
      "<youtube_transcripts>",
      "00:30 The battery lasts all day.",
      "",
      "</youtube_transcripts>",
    ].join("\n"),
  }] as any,
});

assert.ok(
  youtubeHistory.messages.some((message) => message.content.includes("<youtube_transcripts>")),
  "cross-turn YouTube transcript context must remain available",
);

const currentVisualTurn = assembleCoachContext({
  clientMessages: [{ role: "user", content: priorVisualUserTurn }],
});
assert.ok(
  currentVisualTurn.messages.at(-1)?.content.includes("<user_attachments>"),
  "the currently submitted attachment must remain attached to its own turn",
);

console.log("OK: failed visual turn does not contaminate a following ordinary voice turn");
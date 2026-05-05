import fs from "node:fs";

const bundlePath = "server_dist/index.js";
let source = fs.readFileSync(bundlePath, "utf8");

source = source.replace(
  "html = html.replace(/GOOGLE_CLIENT_ID_PLACEHOLDER/g, googleClientId);",
  'html = html.replace("GOOGLE_CLIENT_ID_PLACEHOLDER", googleClientId);',
);

fs.writeFileSync(bundlePath, source);

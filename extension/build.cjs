"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { stage } = require("../tools/stage.cjs");

const output = stage("extension");
const read = file => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const format = read(path.join(__dirname, "..", "shared", "cube-format.cjs"));
for (const file of ["manifest.json", "content.js", "popup.html", "popup.css", "popup.js"]) {
  let content = read(path.join(__dirname, file));
  if (file === "popup.js") {
    // Manifest V3 uses local scripts. Keep the shared helpers in the popup bundle.
    content = `"use strict";
const CubeFormat = (() => {
  const module = { exports: {} };
${format}
  return module.exports;
})();
${content}`;
  }
  fs.writeFileSync(path.join(output, file), content);
}
console.log(`Chrome extension: ${output}`);

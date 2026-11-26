"use strict";
// Compatibility entry point for existing commands and imports.
const server = require("../server.cjs");
if (require.main === module) server.startServer();
module.exports = server;

"use strict";
// Compatibility entry point for existing commands and imports.
const server = require("../backend/server.cjs");
if (require.main === module) server.startServer();
module.exports = server;

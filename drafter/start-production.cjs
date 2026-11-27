"use strict";
// The build copies this file to the runtime archive root as start.cjs.
const path = require("node:path");
const os = require("node:os");
const { startServer } = require("./drafter/backend/server.cjs");

// The next build replaces the artifact directory, so keep state outside it.
process.env.DATA_ROOT ||= path.join(os.homedir(), ".duelingbook-cube-drafter");
startServer();

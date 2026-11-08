#!/usr/bin/env node
"use strict";

const { runCli } = require("../src/cli");

const exitCode = runCli(process.argv.slice(2));
process.exitCode = exitCode;

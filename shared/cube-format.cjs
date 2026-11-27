"use strict";

const CUBE_SCHEMA = "dbcd-cube-v1";

/** @typedef {{id: string, name: string, copies: number}} CubeCard */
/** @typedef {{schema: "dbcd-cube-v1", cards: CubeCard[], exportedAt?: string}} CubeExport */

/** A Cube export has a versioned envelope and a list of card records. */
function isCubeExport(value) {
  return value?.schema === CUBE_SCHEMA && Array.isArray(value.cards);
}

function hasCardName(card) {
  return typeof card?.name === "string" && Boolean(card.name.trim());
}

function hasValidCopies(card, maxCopies) {
  return Number.isInteger(card?.copies) && card.copies >= 1 && card.copies <= maxCopies;
}

module.exports = { CUBE_SCHEMA, isCubeExport, hasCardName, hasValidCopies };

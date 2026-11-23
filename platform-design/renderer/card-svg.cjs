"use strict";
const { measureText, wrapText, fitText } = require("./text-layout-core.cjs");
const { normalizeStyle, regionFont } = require("./style-profile.cjs");
// Uploaded frame coordinates are measured in their original 549 × 800 canvas.
const FRAME_SCALE_X = 813 / 549;
const FRAME_SCALE_Y = 1185 / 800;
const FRAMES = [
  "normal",
  "effect",
  "ritual",
  "fusion",
  "synchro",
  "xyz",
  "link",
  "spell",
  "trap",
];
const ATTRIBUTES = [
  "DARK",
  "LIGHT",
  "EARTH",
  "WATER",
  "FIRE",
  "WIND",
  "DIVINE",
];
const ICONS = [
  "normal",
  "continuous",
  "counter",
  "equip",
  "field",
  "quick-play",
  "ritual",
];
const ARROWS = [
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
  "top-left",
];
const xml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
function capitalizeTypeWords(value) {
  return String(value).replace(/\p{L}[\p{L}\p{M}'’]*/gu, (word) => {
    const [first, ...rest] = Array.from(word);
    return first.toLocaleUpperCase() + rest.join("");
  });
}
function text(value, field, max = 12000) {
  if (value == null) return "";
  if (
    !["string", "number"].includes(typeof value) ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    throw Error(`${field} must be text or a finite number.`);
  const result = String(value);
  if (
    result.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/u.test(result) ||
    /[\uD800-\uDFFF]/u.test(result)
  )
    throw Error(`${field} contains invalid or excessive text.`);
  return result;
}
function optionalCount(value, field) {
  if (value == null || value === "") return null;
  if (!/^[0-9]{1,2}$/.test(String(value)))
    throw Error(`${field} must be an integer from 0 to 99.`);
  return Number(value);
}
function normalizeCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card))
    throw Error("Expected a card JSON object.");
  const name = text(card.name, "name", 200).trim();
  if (!name) throw Error("Card name is required.");
  const v = card.visual ?? {};
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("visual must be an object.");
  if (v.version != null && v.version !== 1)
    throw Error("Unsupported visual metadata version.");
  if (v.frame != null && !FRAMES.includes(v.frame))
    throw Error("Unknown visual.frame.");
  if (v.pendulum != null && typeof v.pendulum !== "boolean")
    throw Error("visual.pendulum must be a boolean.");
  if (v.spellTrapIcon != null && !ICONS.includes(v.spellTrapIcon))
    throw Error("Unknown visual.spellTrapIcon.");
  if (
    v.linkArrows != null &&
    (!Array.isArray(v.linkArrows) ||
      v.linkArrows.length > 8 ||
      v.linkArrows.some((a) => !ARROWS.includes(a)) ||
      new Set(v.linkArrows).size !== v.linkArrows.length)
  )
    throw Error("visual.linkArrows must list unique compass positions.");
  const type = text(card.type, "type", 300),
    effect = text(card.effect, "effect");
  const pendulumEffect = text(card.pendulumEffect, "pendulumEffect");
  const frameUrl = text(card.frame, "frame", 2048);
  const basename = frameUrl
    .split(/[?#]/)[0]
    .split("/")
    .pop()
    .toLowerCase()
    .replace(/_front\d*\.(webp|png|jpg)$/, "")
    .replace(/\.(webp|png|jpg)$/, "");
  const legacyFrame = basename
    .replace(/^pendulum_/, "")
    .replace(/_pendulum$/, "");
  let frame =
    v.frame ||
    (FRAMES.includes(legacyFrame)
      ? legacyFrame
      : [
          "spell",
          "trap",
          "link",
          "xyz",
          "synchro",
          "fusion",
          "ritual",
          "normal",
          "effect",
        ].find((f) => new RegExp(`\\b${f}\\b`, "i").test(type)));
  const warnings = [];
  if (!frame) {
    frame = "unknown";
    warnings.push("frame-unresolved");
  }
  const monster = !["spell", "trap"].includes(frame);
  const pendulum =
    monster &&
    (v.pendulum ??
      (/\bpendulum\b/i.test(type) ||
        /pendulum/.test(basename) ||
        Boolean(pendulumEffect.trim())));
  const attribute = text(card.attribute, "attribute", 100).toUpperCase();
  if (monster && !ATTRIBUTES.includes(attribute))
    warnings.push("attribute-unresolved");
  const count =
    frame === "link"
      ? null
      : optionalCount(
          frame === "xyz" ? (v.rank ?? card.level) : card.level,
          "level/rank",
        );
  if (monster && frame !== "link" && count == null)
    warnings.push("level-rank-unresolved");
  if (frame === "xyz" && v.rank == null && card.level != null)
    warnings.push("rank-from-legacy-level: verify against original");
  let icon = v.spellTrapIcon;
  if (!monster && !icon)
    icon = ICONS.find((i) =>
      new RegExp(`\\b${i === "quick-play" ? "quick[- ]play" : i}\\b`, "i").test(
        type,
      ),
    );
  if (!monster && !icon) warnings.push("spell-trap-icon-unresolved");
  const scaleLeft = optionalCount(v.scaleLeft, "visual.scaleLeft"),
    scaleRight = optionalCount(v.scaleRight, "visual.scaleRight");
  if (pendulum && (scaleLeft == null || scaleRight == null))
    warnings.push("pendulum-scales-unresolved");
  const linkArrows = v.linkArrows ?? [];
  if (frame === "link" && !linkArrows.length)
    warnings.push("link-arrows-unresolved");
  return {
    name,
    type,
    effect,
    pendulumEffect,
    frame,
    monster,
    pendulum,
    attribute,
    count,
    icon,
    scaleLeft,
    scaleRight,
    linkArrows,
    atk: text(card.atk, "atk", 32),
    def: text(card.def, "def", 32),
    link: text(card.link, "link", 32),
    artwork: text(card.artwork, "artwork", 2048),
    warnings,
  };
}
function composeCard(card, registry, style) {
  const c = normalizeCard(card),
    diagnostics = [...c.warnings];
  const predefined = registry.profile === "predefined-813-v1";
  const textured = predefined || registry.profile === "tcg-813-v1";
  const tuning = normalizeStyle(style);
  const typeFont = registry.assets.get("font.type");
  const statsFaceActive = predefined && c.monster && registry.assets.get("font.stats") && tuning.regions.stats.font === "body";
  const originalTypeFaceActive = (key) =>
    predefined && Boolean(typeFont) && tuning.regions[key].font === "body" &&
    ((key === "type" && c.monster) ||
      (key === "kind" && ["spell", "trap"].includes(c.frame)));
  const lightenName =
    textured &&
    Boolean(registry.assets.get("font.name")) &&
    (!predefined || tuning.regions.name.font === "name");
  const adjustableNameWeight = predefined && lightenName;
  const adjustableRegion = (key) =>
    predefined && key !== "name" &&
    (["body", "name"].includes(tuning.regions[key].font) ||
      tuning.regions[key].font.startsWith("upload-") ||
      (key === "stats" && c.frame === "link" &&
        Boolean(registry.assets.get("font.link-rating"))));
  const weightFilter = (key) => {
    const region = tuning.regions[key], baseWeight = originalTypeFaceActive(key) ? 900 : 400;
    if (!adjustableRegion(key) || region.weight === baseWeight) return "";
    const stroke = region.weight > baseWeight
      ? ` stroke="#000" stroke-width="${(region.size * 3 / 95) * ((region.weight - baseWeight) / (900 - baseWeight)) * 1.2}" stroke-linejoin="round" paint-order="stroke fill"`
      : "";
    return ` filter="url(#card-${key}-weight)"${stroke}`;
  };
  const nameColor = ["spell", "trap", "xyz", "link"].includes(c.frame)
    ? "#fff"
    : "#000";
  function regionAttributes(key, forceItalic = false) {
    const r = tuning.regions[key],
      font = regionFont(tuning, registry, key),
      family = originalTypeFaceActive(key)
        ? "CardTypeLine"
        : key === "stats" && statsFaceActive ? "CardStats" : font.family;
    // The bundled name face is static; the mask below supplies its weight steps
    // without the browser's abrupt synthetic-bold switch.
    const weight =
      (key === "name" && adjustableNameWeight) || adjustableRegion(key)
        ? 400
        : r.weight;
    return `font-family="${family}" font-weight="${weight}" font-style="${forceItalic || r.italic ? "italic" : "normal"}" letter-spacing="${r.letterSpacing}" font-kerning="${r.font.startsWith("upload-") ? "none" : "normal"}"`;
  }
  const rasterDefinitions = new Map();
  function asset(key) {
    const data = registry.assets.get(key) || registry.composites?.get(key);
    if (!data) diagnostics.push(`missing-asset:${key}`);
    return data;
  }
  function image(data, x, y, width, height, extra = "") {
    if (data && typeof data === "object")
      return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 ${data.width} ${data.height}" ${extra}>${data.layers.map((layer) => image(layer.data, layer.x, layer.y, layer.width, layer.height)).join("")}</svg>`;
    const size = registry.imageSizes?.get(data);
    if (size) {
      let raster = rasterDefinitions.get(data);
      if (!raster) {
        const id = "raster-" + rasterDefinitions.size;
        raster = {
          id,
          svg: `<image id="${id}" width="${size.width}" height="${size.height}" href="${data}"/>`,
        };
        rasterDefinitions.set(data, raster);
      }
      return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 ${size.width} ${size.height}" ${extra}><use href="#${raster.id}"/></svg>`;
    }
    return data
      ? `<image x="${x}" y="${y}" width="${width}" height="${height}" href="${data}" ${extra}/>`
      : "";
  }
  function label(value, x, y, size = 24, extra = "") {
    return `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${xml(value)}</text>`;
  }
  function fittedLines(value, x, top, width, height, block) {
    const r = tuning.regions[block];
    const metrics = predefined
      ? regionFont(tuning, registry, block).metrics
      : registry.fontMetrics?.body;
    const layout = fitText(value, {
      font: metrics,
      width,
      height,
      ...(predefined
        ? {
            preferredSize: r.size,
            minSize: r.minSize,
            letterSpacing: r.letterSpacing,
            lineHeight: r.lineHeight,
          }
        : {}),
    });
    if (layout.overflow)
      diagnostics.push("text-overflow: full text retained in SVG description");
    const italicFlavor = c.frame === "normal" && block === "effect";
    let lineCount = 0;
    const paragraphEnds = new Set();
    for (const paragraph of String(value).split(/\r?\n/)) {
      lineCount += wrapText(
        paragraph,
        width,
        metrics,
        layout.fontSize,
        predefined ? r.letterSpacing : 0,
      ).length;
      paragraphEnds.add(lineCount - 1);
    }
    return `<g data-text-block="${block}" fill="#000000" ${predefined ? regionAttributes(block, italicFlavor) + weightFilter(block) : `font-family="CardBody, Georgia, serif" font-style="${italicFlavor ? "italic" : "normal"}" font-kerning="normal"`} font-variant-ligatures="none">${layout.lines.map((line, i) => label(line, x + (predefined ? r.offsetX : 0), top + layout.ascent + i * layout.lineHeight + (predefined ? r.offsetY : 0), layout.fontSize, !paragraphEnds.has(i) && line.includes(" ") ? `textLength="${width}" lengthAdjust="spacing"` : "")).join("")}</g>`;
  }
  // Both borders are sampled from the same unchanged, gray/gold Effect frame.
  // Cropping in the SVG keeps every upstream PNG byte intact.
  const commonFrame =
    textured && !predefined ? registry.assets.get("layer.frame.effect") : null;
  function artBorder(box) {
    const [x, y, w, h] = box;
    if (commonFrame)
      return `<svg data-card-border="art" x="${x - 14}" y="${y - 14}" width="${w + 28}" height="${h + 28}" viewBox="86 205 642 642" preserveAspectRatio="none" overflow="hidden"><g filter="url(#gray-art-border)"><use href="#common-card-frame"/></g></svg>`;
    return `<g data-card-border="art"><polygon points="${x - 14},${y - 14} ${x + w + 14},${y - 14} ${x + w},${y} ${x},${y}" fill="#929292"/><polygon points="${x - 14},${y - 14} ${x},${y} ${x},${y + h} ${x - 14},${y + h + 14}" fill="#737373"/><polygon points="${x + w + 14},${y - 14} ${x + w + 14},${y + h + 14} ${x + w},${y + h} ${x + w},${y}" fill="#3f3f3f"/><polygon points="${x - 14},${y + h + 14} ${x},${y + h} ${x + w},${y + h} ${x + w + 14},${y + h + 14}" fill="#575757"/></g>`;
  }
  function textBorder() {
    if (commonFrame)
      return '<svg data-card-border="effect" x="40" y="876" width="735" height="250" viewBox="45 876 724 250" preserveAspectRatio="none" overflow="hidden"><use href="#common-card-frame"/></svg>';
    const top = textured ? 885 : c.pendulum ? 905 : 765;
    return `<rect data-card-border="effect" x="55" y="${top}" width="703" height="${1100 - top}" fill="none" stroke="#b68e3b" stroke-width="4"/>`;
  }
  // Keep the original schematic fallback for manifests without a textured layout.
  function lines(value, x, y, width, maxLines, block = "effect", justifyWidth = 659) {
    const chunks = [], paragraphEnds = new Set();
    for (const paragraph of value.split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        for (const piece of Array.from(word)
          .join("")
          .match(new RegExp(`.{1,${width}}`, "gu")) || [""]) {
          if (Array.from(line + " " + piece).length > width && line) {
            chunks.push(line);
            line = "";
          }
          line += (line ? " " : "") + piece;
        }
      }
      chunks.push(line);
      paragraphEnds.add(chunks.length - 1);
    }
    if (chunks.length > maxLines)
      diagnostics.push("text-overflow: full text retained in SVG description");
    return (
      `<g data-text-block="${block}" font-style="${c.frame === "normal" && block === "effect" ? "italic" : "normal"}">` +
      chunks
        .slice(0, maxLines)
        .map((l, i) =>
          label(
            l,
            x,
            y + i * 25,
            21,
            'font-family="CardBody, Georgia, serif" fill="#000000"' +
              (!paragraphEnds.has(i) && l.includes(" ")
                ? ` textLength="${justifyWidth}" lengthAdjust="spacing"`
                : ""),
          ),
        )
        .join("") +
      "</g>"
    );
  }
  const colors = {
    normal: "#d6b96d",
    effect: "#be8759",
    ritual: "#7498cc",
    fusion: "#9876b2",
    synchro: "#e4e2da",
    xyz: "#34363d",
    link: "#35699c",
    spell: "#62b5a4",
    trap: "#bb78a2",
    unknown: "#9ca5b5",
  };
  const background = asset(
      `background.${c.frame}${c.pendulum && !predefined ? "-pendulum" : ""}`,
    ),
    border = predefined ? null : asset("border");
  const nameFont = (predefined && registry.assets.get("font.stats")) || asset("font.name"),
    bodyFont = asset("font.body"),
    linkFont = c.frame === "link" ? registry.assets.get("font.link-rating") : null;
  const fontCss =
    (registry.assets.get("font.text") ? `@font-face{font-family:CardText;src:url('${registry.assets.get("font.text")}');font-weight:400;font-style:normal}` : "") +
    (statsFaceActive || (c.pendulum && registry.assets.get("font.stats")) ? `@font-face{font-family:CardStats;src:url('${registry.assets.get("font.stats")}');font-weight:400;font-style:normal}` : "") +
    (nameFont
      ? `@font-face{font-family:CardName;src:url('${nameFont}')} `
      : "") +
    (bodyFont
      ? `@font-face{font-family:CardBody;src:url('${bodyFont}')}`
      : "") +
    ((originalTypeFaceActive("type") || originalTypeFaceActive("kind"))
      ? `@font-face{font-family:CardTypeLine;src:url('${typeFont}');font-weight:400;font-style:normal}`
      : "") +
    (linkFont
      ? `@font-face{font-family:CardLinkRating;src:url('${linkFont}');font-weight:400;font-style:normal}`
      : "") +
    (predefined
      ? Object.entries(tuning.fonts)
          .map(
            ([id, font]) =>
              `@font-face{font-family:Custom_${id};src:url('data:font/woff2;base64,${font.data}')}`,
          )
          .join("")
      : "");
  if (
    predefined &&
    Object.values(tuning.regions).some(
      (region) =>
        !["name", "body"].includes(region.font) &&
        !tuning.fonts[region.font]?.metrics,
    )
  )
    diagnostics.push(
      "font-metrics-approximate: calibrate uploaded fonts in the tester",
    );
  let body =
    predefined && background
      ? ""
      : `<rect width="813" height="1185" rx="24" fill="#3d3530"/><rect x="25" y="25" width="763" height="1135" rx="10" fill="${colors[c.frame]}"/>`;
  // Rasterize every name in black: Chromium gives white source glyphs heavier
  // antialiased coverage. Apply the final color only after forming the mask.
  // The bundled face retains its adjustable solid core and softer outer edge.
  let nameMask = lightenName ? "name-alpha" : "SourceAlpha";
  let nameFilter = lightenName
    ? `<feMorphology in="SourceAlpha" operator="erode" radius="0.65" result="name-core"/><feComponentTransfer in="SourceAlpha" result="name-edge"><feFuncA type="linear" slope="${predefined ? tuning.regions.name.edgeOpacity : 0.45}"/></feComponentTransfer><feMerge result="name-mask"><feMergeNode in="name-edge"/><feMergeNode in="name-core"/></feMerge><feComposite in="SourceAlpha" in2="name-mask" operator="in" result="name-alpha"/>`
    : "";
  if (adjustableNameWeight && tuning.regions.name.weight !== 400) {
    const { weight, size } = tuning.regions.name,
      lighter = weight < 400,
      amount = (Math.abs(weight - 400) / (lighter ? 300 : 500)) *
        (lighter ? 0.7 : 0.6),
      radius = (size * 3) / 95;
    // Blend toward a thinner/thicker outline. Varying only morphology's radius
    // would quantize adjacent weights to the same pixels at thumbnail sizes.
    // Retain some original coverage so light weights do not lose fine serifs.
    if (lighter) {
      nameFilter += `<feMorphology in="${nameMask}" operator="erode" radius="${radius}" result="name-weight-limit"/><feComposite in="name-weight-limit" in2="${nameMask}" operator="arithmetic" k1="0" k2="${amount}" k3="${1 - amount}" k4="0" result="name-weight-alpha"/>`;
      nameMask = "name-weight-alpha";
    } else {
      // Preserve the base mask and increase edge coverage continuously. A fixed
      // slope of 8 here made the first step above 400 abruptly look bold.
      nameFilter += `<feComponentTransfer in="${nameMask}" result="name-solid-alpha"><feFuncA type="linear" slope="${1 + 7 * (weight - 400) / 500}" intercept="0"/></feComponentTransfer>`;
      nameMask = "name-solid-alpha";
    }
  }
  body += `<defs><filter id="card-name-weight" x="-15%" y="-25%" width="130%" height="150%" color-interpolation-filters="sRGB">${nameFilter}<feFlood flood-color="${nameColor}" result="name-color"/><feComposite in="name-color" in2="${nameMask}" operator="in"/></filter></defs>`;
  if (predefined)
    for (const key of ["effect", "pendulum", "kind", "type", "stats"]) {
      const region = tuning.regions[key];
      const baseWeight = originalTypeFaceActive(key) ? 900 : 400;
      if (!adjustableRegion(key) || region.weight === baseWeight) continue;
      const lighter = region.weight < baseWeight,
        amount = originalTypeFaceActive(key)
          ? ((900 - region.weight) / 800) * 0.7
          : (Math.abs(region.weight - 400) / (lighter ? 300 : 500)) *
            (lighter ? 0.7 : 0.6),
        radius = Math.max(1.5, (region.size * 3) / 95),
        color = ["effect", "pendulum", "stats"].includes(key)
          ? "#000000"
          : "#171b20";
      const mask = lighter
        ? `<feMorphology in="SourceAlpha" operator="erode" radius="${radius}" result="weight-limit"/><feComposite in="weight-limit" in2="SourceAlpha" operator="arithmetic" k1="0" k2="${amount}" k3="${1 - amount}" k4="0" result="weight-alpha"/>`
        : `<feComponentTransfer in="SourceAlpha" result="weight-alpha"><feFuncA type="linear" slope="${1 + 7 * (region.weight - baseWeight) / (900 - baseWeight)}" intercept="0"/></feComponentTransfer>`;
      body += `<defs><filter id="card-${key}-weight" x="-15%" y="-25%" width="130%" height="150%" color-interpolation-filters="sRGB">${mask}<feFlood flood-color="${color}" result="weight-color"/><feComposite in="weight-color" in2="weight-alpha" operator="in"/></filter></defs>`;
    }
  if (commonFrame)
    body +=
      '<defs><filter id="gray-art-border" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter>' +
      image(commonFrame, 0, 0, 813, 1185, 'id="common-card-frame"') +
      "</defs>";
  if (textured && bodyFont && !registry.fontMetrics?.body)
    diagnostics.push("font-metrics-approximate: custom body font");
  body += image(
    background,
    0,
    0,
    813,
    1185,
    predefined ? 'preserveAspectRatio="none" data-card-frame="base"' : "",
  );
  // These complete frames already contain all bevels, text boxes and stat labels.
  // The large Pendulum image is transparent over the underlying monster header.
  // Keep its green surround inside the base card's original outer border.
  if (predefined && c.pendulum)
    body +=
      `<defs><clipPath id="pendulum-face"><rect x="${19 * FRAME_SCALE_X}" y="${19 * FRAME_SCALE_Y}" width="${511 * FRAME_SCALE_X}" height="${762 * FRAME_SCALE_Y}"/></clipPath></defs><g clip-path="url(#pendulum-face)">` +
      image(
        asset("overlay.pendulum"),
        0,
        0,
        813,
        1185,
        'preserveAspectRatio="none" data-card-frame="pendulum"',
      ) +
      "</g>";
  if (!textured || !background)
    body += `<rect x="50" y="48" width="713" height="75" fill="#fff" fill-opacity=".35"/>`;
  body += label(
    c.name,
    65 + (predefined ? tuning.regions.name.offsetX : 0),
    (textured ? 120 : 100) + (predefined ? tuning.regions.name.offsetY : 0),
    predefined
      ? tuning.regions.name.size
      : textured
        ? 80
        : Math.min(38, Math.max(15, 1050 / Array.from(c.name).length)),
    `data-text-block="name" ${predefined ? regionAttributes("name") : 'font-family="CardName, Georgia, serif"'} filter="url(#card-name-weight)" fill="#000"` +
      (adjustableNameWeight && tuning.regions.name.weight > 400
        ? ` stroke="#000" stroke-width="${(tuning.regions.name.size * 3 / 95) * ((tuning.regions.name.weight - 400) / 500) * 1.2}" stroke-linejoin="round" paint-order="stroke fill"`
        : "") +
      ((
        textured
          ? measureText(
              c.name,
              predefined
                ? regionFont(tuning, registry, "name").metrics
                : registry.fontMetrics?.name,
              predefined ? tuning.regions.name.size : 80,
              predefined ? tuning.regions.name.letterSpacing : 0,
            ) > 600
          : Array.from(c.name).length > 28
      )
        ? ' textLength="600" lengthAdjust="spacingAndGlyphs"'
        : ""),
  );
  if (c.monster) {
    const attribute = ATTRIBUTES.includes(c.attribute)
      ? asset(`attribute.${c.attribute}`)
      : null;
    body += attribute
      ? image(
          attribute,
          textured ? 680 : 693,
          54,
          textured ? 76 : 65,
          textured ? 76 : 65,
        )
      : `<circle cx="725" cy="87" r="32" fill="#ddd"/>` +
        label(c.attribute || "?", 725, 94, 15, 'text-anchor="middle"');
    if (c.frame !== "link") {
      const size = predefined ? tuning.stars.size : 42,
        gap = predefined ? tuning.stars.gap : 7,
        // Rank rows share the regular Xyz artwork bevel's left edge.
        rankLeft = 58 * FRAME_SCALE_X,
        // Pendulum and regular Level rows share the regular artwork bevel's right edge.
        frameRight = 491 * FRAME_SCALE_X,
        rowWidth = c.count * size + Math.max(0, c.count - 1) * gap,
        rowOverflow = c.count > 13 || rowWidth > 680;
      if (c.count != null && !rowOverflow) {
        const star = asset(c.frame === "xyz" ? "icon.rank" : "icon.level"),
          start =
            c.frame === "xyz"
              ? predefined ? rankLeft : 63
              : predefined
                ? frameRight - rowWidth
                : 750 - c.count * (size + gap);
        if (star)
          body +=
            "<defs>" + image(star, 0, 0, size, size, 'id="star"') + "</defs>";
        for (let i = 0; i < c.count; i++)
          body += star
            ? `<use href="#star" data-star-index="${i}" x="${start + i * (size + gap)}" y="${textured ? 148 : 139}"/>`
            : `<g data-star="${c.frame === "xyz" ? "rank" : "level"}"><circle cx="${start + i * (size + gap) + size / 2}" cy="${(textured ? 148 : 139) + size / 2}" r="${size / 2}" fill="${c.frame === "xyz" ? "#383838" : "#bc662b"}"/>${label("★", start + i * (size + gap) + size / 2, (textured ? 148 : 139) + size * 0.72, size * 0.69, 'text-anchor="middle" fill="#ffd85b"')}</g>`;
      } else {
        body += label(
          `${c.frame === "xyz" ? "RANK" : "LEVEL"} ${c.count ?? "?"}`,
          predefined ? c.frame === "xyz" ? rankLeft : frameRight : 748,
          174,
          24,
          `text-anchor="${predefined && c.frame === "xyz" ? "start" : "end"}"`,
        );
        if (rowOverflow)
          diagnostics.push("star-row-overflow: numeric count shown");
      }
    }
  } else {
    if (textured)
      body += image(
        asset(`attribute.${c.frame.toUpperCase()}`),
        680,
        54,
        76,
        76,
      );
    const kind = tuning.regions.kind,
      size = predefined ? kind.size : textured ? 40 : 30,
      font = predefined
        ? regionFont(tuning, registry, "kind").metrics
        : registry.fontMetrics?.body,
      spacing = predefined ? kind.letterSpacing : 0,
      right =
        (predefined ? 491 * FRAME_SCALE_X : textured ? 728 : 757) +
        (predefined ? kind.offsetX : 0),
      baseline = (textured ? 185 : 172) + (predefined ? kind.offsetY : 0),
      gap = Math.max(4, measureText(" ", font, size) + spacing),
      bracketLeft = right - measureText("]", font, size, spacing),
      hasIcon = c.icon !== "normal",
      iconSize = 54,
      iconLeft = bracketLeft - gap - iconSize,
      labelRight = hasIcon ? iconLeft - gap : bracketLeft - gap;
    // Keep the subtype inside the brackets and the closing bracket aligned
    // with the artwork bevel, whether or not this card has a subtype icon.
    body += `<g data-text-block="kind"${predefined ? " " + regionAttributes("kind") : textured ? ' font-weight="bold"' : ""}>`;
    body += label(
      c.frame === "spell" ? "[ SPELL CARD" : "[ TRAP CARD",
      labelRight,
      baseline,
      size,
      'data-kind-part="label" text-anchor="end"' + weightFilter("kind"),
    );
    if (hasIcon) {
      const icon = c.icon ? asset(`icon.${c.icon}`) : null;
      body += icon
        ? image(
            icon,
            iconLeft,
            baseline - 40,
            iconSize,
            iconSize,
            `data-kind-icon="${c.icon}"`,
          )
        : label(
            c.icon || "?",
            iconLeft + iconSize / 2,
            baseline,
            c.icon ? 14 : 30,
            'data-kind-icon="unresolved" text-anchor="middle"',
          );
    }
    body +=
      label(
        "]",
        right,
        baseline,
        size,
        'data-kind-part="close" text-anchor="end"' + weightFilter("kind"),
      ) + "</g>";
  }
  const art = registry.artworks.get(c.artwork);
  if (!art)
    diagnostics.push("missing-artwork: local source URL mapping required");
  const artBox = predefined
    ? c.pendulum
      ? [
          38 * FRAME_SCALE_X,
          145 * FRAME_SCALE_Y,
          472 * FRAME_SCALE_X,
          (art ? 582 : 352) * FRAME_SCALE_Y,
        ]
      : [
          68 * FRAME_SCALE_X,
          148 * FRAME_SCALE_Y,
          414 * FRAME_SCALE_X,
          415 * FRAME_SCALE_Y,
        ]
    : textured
      ? c.pendulum
        ? [56, 213, 702, 530]
        : [100, 219, 614, 614]
      : [70, 210, 673, 505];
  if (!predefined) {
    body += artBorder(artBox);
    body += `<rect x="${artBox[0]}" y="${artBox[1]}" width="${artBox[2]}" height="${artBox[3]}" fill="#273544"/>`;
  }
  // Preserve Link sockets and the Pendulum aperture's bottom corner hardware.
  const effectBoxClips = `<rect transform="scale(${FRAME_SCALE_X} ${FRAME_SCALE_Y})" x="83" y="505" width="384" height="108"/><rect transform="scale(${FRAME_SCALE_X} ${FRAME_SCALE_Y})" x="40" y="623" width="469" height="104"/>`;
  const artAperture =
    predefined && c.pendulum
      ? "38,145 510,145 510,491 504,497 44,497 38,491"
      : predefined && c.frame === "link"
        ? "97,148 451,148 482,179 482,532 451,563 97,563 68,534 68,177"
        : null;
  if (artAperture)
    body += `<defs><clipPath id="art-aperture"><polygon transform="scale(${FRAME_SCALE_X} ${FRAME_SCALE_Y})" points="${artAperture}"/>${predefined && c.pendulum && art ? effectBoxClips : ""}</clipPath></defs><g clip-path="url(#art-aperture)">`;
  body += image(
    art,
    // Overlap the aperture edge by one source pixel to cover white template
    // pixels and fractional scaling seams. Pendulum foreground art cover-crops
    // to the opening rather than letterboxing portrait source images.
    ...(predefined
      ? [artBox[0] - FRAME_SCALE_X, artBox[1] - FRAME_SCALE_Y,
          artBox[2] + 2 * FRAME_SCALE_X, c.pendulum ? 354 * FRAME_SCALE_Y : artBox[3] + 2 * FRAME_SCALE_Y]
      : artBox),
    `preserveAspectRatio="${predefined && c.pendulum ? "xMidYMin slice" : "none"}" data-card-artwork="true"`,
  );
  if (artAperture) body += "</g>";
  if (predefined && c.pendulum && art) {
    // Keep the original artwork continuation beneath translucent text boxes
    // separate from the cover-cropped, borderless foreground aperture.
    body += `<defs><clipPath id="pendulum-effect-backgrounds">${effectBoxClips}</clipPath></defs><g clip-path="url(#pendulum-effect-backgrounds)">` +
      image(art, artBox[0] - FRAME_SCALE_X, artBox[1] - FRAME_SCALE_Y,
        artBox[2] + 2 * FRAME_SCALE_X, artBox[3] + 2 * FRAME_SCALE_Y,
        'preserveAspectRatio="xMidYMin meet" data-pendulum-art-continuation="true"') +
      '<g data-effect-backgrounds="pendulum" opacity="0.9">' +
      image(background, 0, 0, 813, 1185, 'preserveAspectRatio="none"') +
      image(asset("overlay.pendulum"), 0, 0, 813, 1185, 'preserveAspectRatio="none"') + "</g></g>";
  }
  if (!art && !predefined)
    body += label(
      "Artwork unavailable locally",
      406,
      textured ? artBox[1] + artBox[3] / 2 : 465,
      26,
      'text-anchor="middle" fill="#e2e8f0"',
    );
  if (c.frame === "link" && predefined) {
    // Trace the preprinted socket interiors in the 549x800 source template.
    // Subpixel edges preserve the bevel while avoiding gaps in diagonal fills.
    const points = [
      "244,142 274.5,122 306,142",
      "465.5,133 497,133 497,164.5",
      "488,323 507.5,354.5 488,386",
      "497,545 497,577 465,577",
      "242.8,568 274.5,587.5 307.5,568",
      "52,545 52,577 84,577",
      "61,324 42.5,354.5 61,385.5",
      "53,133 84.5,133 53,164.5",
    ];
    body += '<defs><linearGradient id="active-link-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f1654c"/><stop offset="1" stop-color="#d93629"/></linearGradient></defs>';
    for (const direction of c.linkArrows)
      body += `<polygon data-link-arrow="${direction}" transform="scale(${FRAME_SCALE_X} ${FRAME_SCALE_Y})" points="${points[ARROWS.indexOf(direction)]}" fill="url(#active-link-fill)" shape-rendering="geometricPrecision"/>`;
  } else if (c.frame === "link") {
    const arrow = c.linkArrows.length ? asset("icon.link-arrow") : null;
    const positions = textured
      ? [
          [407, 220, 0],
          [710, 222, 45],
          [720, 526, 90],
          [710, 827, 135],
          [407, 831, 180],
          [103, 827, 225],
          [97, 526, 270],
          [103, 222, 315],
        ]
      : [
          [406, 220, 0],
          [715, 225, 45],
          [735, 462, 90],
          [715, 700, 135],
          [406, 705, 180],
          [95, 700, 225],
          [77, 462, 270],
          [95, 225, 315],
        ];
    for (const direction of c.linkArrows) {
      const [x, y, angle] = positions[ARROWS.indexOf(direction)];
      body += `<g transform="translate(${x} ${y}) rotate(${angle})">${arrow ? image(arrow, -23, -23, 46, 46) : '<path d="M0 -22 L21 18 L0 9 L-21 18Z" fill="#df563e"/>'}</g>`;
    }
  }
  if (c.pendulum) {
    if (textured && !predefined)
      body += image(asset("overlay.pendulum"), 0, 0, 813, 1185);
    if (textured && !predefined) body += artBorder(artBox);
    if (!textured || !background)
      body += `<rect x="55" y="740" width="703" height="140" fill="#e2efe6" stroke="#3f6b76" stroke-width="3"/>`;
    body +=
      label(
        c.scaleLeft ?? "?",
        textured ? 84.4 : 80,
        predefined ? 884 : textured ? 792 : 815,
        textured ? 62 : 35,
        'data-pendulum-scale="left" text-anchor="middle" fill="#000000" font-family="CardStats, CardName, serif" font-weight="400"',
      ) +
      label(
        c.scaleRight ?? "?",
        textured ? 728 : 733,
        predefined ? 884 : textured ? 792 : 815,
        textured ? 62 : 35,
        'data-pendulum-scale="right" text-anchor="middle" fill="#000000" font-family="CardStats, CardName, serif" font-weight="400"',
      );
    body += textured
      ? fittedLines(
          c.pendulumEffect || "Pendulum text unavailable",
          129,
          predefined ? 754 : 749,
          545,
          predefined ? 151 : 122,
          "pendulum",
        )
      : lines(
          c.pendulumEffect || "Pendulum text unavailable",
          textured ? 129 : 110,
          773,
          textured ? 45 : 49,
          4,
          "pendulum",
          583,
        );
  }
  const boxY =
      predefined && c.pendulum ? 919 : textured ? 885 : c.pendulum ? 905 : 765,
    textY = textured ? (c.monster ? 947 : 919) : boxY + 69;
  if (!textured || !background)
    body += `<rect x="55" y="${boxY}" width="703" height="${1100 - boxY}" fill="#f2e9d6" stroke="#655b50" stroke-width="3"/>`;
  if (textured && !predefined) {
    const texture = registry.assets.get(`layer.text.${c.frame}`);
    if (texture)
      body += image(texture, 49, 885, 717, 231, 'preserveAspectRatio="none"');
  }
  if (c.monster || !textured)
    body += label(
      c.type ? capitalizeTypeWords(c.type) : "Type Unavailable",
      (textured ? 65 : 72) + (predefined ? tuning.regions.type.offsetX : 0),
      boxY + 33 + (predefined ? tuning.regions.type.offsetY : 0),
      predefined ? tuning.regions.type.size : textured ? 26 : 24,
      'data-text-block="type" ' +
        (predefined ? regionAttributes("type") + weightFilter("type") : 'font-weight="bold"'),
    );
  body += textured
    ? fittedLines(
        c.effect,
        65,
        c.monster ? boxY + 44 : 899,
        675,
        c.monster ? (predefined ? 1070 - (boxY + 44) : 149) : 205,
        "effect",
      )
    : lines(
        c.effect,
        72,
        textY,
        58,
        textured ? (c.monster ? 6 : 7) : c.pendulum ? 4 : 10,
      );
  if (c.monster && predefined) {
    const r = tuning.regions.stats,
      statsFont = regionFont(tuning, registry, "stats");
    const stat = `text-anchor="end" fill="#000000" ${regionAttributes("stats")}${weightFilter("stats")}`;
    const value = (text, x, width, block) => {
      const special = block === "link" && linkFont,
        attributes = special
          ? `text-anchor="end" fill="#000000" font-family="CardLinkRating" font-weight="400" font-style="normal" font-kerning="none" letter-spacing="${r.letterSpacing}"${weightFilter("stats")}`
          : stat,
        metrics = special ? registry.fontMetrics?.["link-rating"] : statsFaceActive ? registry.fontMetrics?.stats : statsFont.metrics;
      return label(
        text,
        x + r.offsetX,
        tuning.stats.baseline + r.offsetY,
        r.size,
        `data-text-block="${block}" ${attributes}` +
          (measureText(text, metrics, r.size, r.letterSpacing) > width
            ? ` textLength="${width}" lengthAdjust="spacingAndGlyphs"`
            : ""),
      );
    };
    body += value(
      c.atk || "?",
      tuning.stats.atkX,
      Math.max(8, tuning.stats.atkX - 510),
      "atk",
    );
    body += value(
      c.frame === "link"
        ? c.link.replace(/^LINK\s*[-/]?\s*/i, "") || "?"
        : c.def || "?",
      tuning.stats.defX,
      Math.max(8, tuning.stats.defX - (c.frame === "link" ? 719 : 674)),
      c.frame === "link" ? "link" : "def",
    );
  } else if (c.monster && c.frame === "link" && linkFont) {
    const rating = c.link.replace(/^LINK\s*[-/]?\s*/i, "") || "?";
    body += `<text x="742" y="${textured ? 1098 : 1130}" font-size="26" text-anchor="end" font-weight="bold" fill="${textured ? "#171b20" : "#f8f5eb"}">${xml(`ATK / ${c.atk || "?"}   LINK-`)}<tspan data-text-block="link" font-family="CardLinkRating" font-weight="400" font-style="normal" font-kerning="none">${xml(rating)}</tspan></text>`;
  } else if (c.monster)
    body += label(
      `ATK / ${c.atk || "?"}   ${c.frame === "link" ? c.link || "LINK-?" : "DEF / " + (c.def || "?")}`,
      742,
      textured ? 1098 : 1130,
      26,
      `text-anchor="end" font-weight="bold" fill="${!textured && ["xyz", "link"].includes(c.frame) ? "#f8f5eb" : "#171b20"}"`,
    );
  if (!predefined) body += textBorder();
  body += image(border, 0, 0, 813, 1185);
  if (diagnostics.length && !predefined)
    body += label(
      "RENDER PREVIEW · see diagnostics",
      406,
      1163,
      14,
      'text-anchor="middle" fill="#fff" stroke="#333" stroke-width=".3"',
    );
  const fontCredit = (statsFaceActive ? "ATK/DEF: Yu-Gi-Oh! Matrix Small Caps 1 Regular. ©1991 Emigre Graphics. " : "") + (linkFont
    ? "Link Rating: Eurostile Candy W02 Bold; typeface artwork Linotype Design Studio; Copyright © 2008 Linotype GmbH. Source: OnlineWebFonts.com."
    : "");
  const typeCredit = (originalTypeFaceActive("type") || originalTypeFaceActive("kind"))
    ? "Card type: Yu-Gi-Oh! ITC Stone Serif Bold Small Caps. Copyright © 1987, 1990, 1992 Adobe Systems Incorporated; ITC Stone trademark of International Typeface Corporation."
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="813" height="1185" viewBox="0 0 813 1185" role="img"><title>${xml(c.name)}</title><desc>${xml([c.type, c.pendulumEffect, c.effect, ...diagnostics, fontCredit, typeCredit].join("\n"))}</desc><defs>${[...rasterDefinitions.values()].map((raster) => raster.svg).join("")}</defs><style>${fontCss}</style><g font-family="CardBody, Georgia, serif" fill="#171b20">${body}</g></svg>`;
  return { svg, diagnostics: [...new Set(diagnostics)], model: c };
}
module.exports = { normalizeCard, composeCard };

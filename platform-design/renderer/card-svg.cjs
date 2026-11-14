"use strict";
const { measureText, fitText } = require("./text-layout-core.cjs");
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
  const lightenName =
    textured &&
    Boolean(registry.fontMetrics?.name) &&
    (!predefined || tuning.regions.name.font === "name");
  function regionAttributes(key, forceItalic = false) {
    const r = tuning.regions[key],
      font = regionFont(tuning, registry, key);
    return `font-family="${font.family}" font-weight="${r.weight}" font-style="${forceItalic || r.italic ? "italic" : "normal"}" letter-spacing="${r.letterSpacing}" font-kerning="${r.font.startsWith("upload-") ? "none" : "normal"}"`;
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
    const layout = fitText(value, {
      font: predefined
        ? regionFont(tuning, registry, block).metrics
        : registry.fontMetrics?.body,
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
    return `<g data-text-block="${block}" fill="#000000" ${predefined ? regionAttributes(block, italicFlavor) : `font-family="CardBody, Georgia, serif" font-style="${italicFlavor ? "italic" : "normal"}" font-kerning="normal"`} font-variant-ligatures="none">${layout.lines.map((line, i) => label(line, x + (predefined ? r.offsetX : 0), top + layout.ascent + i * layout.lineHeight + (predefined ? r.offsetY : 0), layout.fontSize)).join("")}</g>`;
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
  function lines(value, x, y, width, maxLines, block = "effect") {
    const chunks = [];
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
            'font-family="CardBody, Georgia, serif" fill="#000000"',
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
  const nameFont = asset("font.name"),
    bodyFont = asset("font.body");
  const fontCss =
    (nameFont
      ? `@font-face{font-family:CardName;src:url('${nameFont}')} `
      : "") +
    (bodyFont
      ? `@font-face{font-family:CardBody;src:url('${bodyFont}')}`
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
  // The bundled face has bold strokes baked into its outlines. Retain its
  // exact glyph geometry, with a solid inner stroke and softer outer coverage.
  if (lightenName)
    body += `<defs><filter id="card-name-weight" x="-5%" y="-10%" width="110%" height="120%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="erode" radius="0.65" result="name-core"/><feComponentTransfer in="SourceAlpha" result="name-edge"><feFuncA type="linear" slope="${predefined ? tuning.regions.name.edgeOpacity : 0.45}"/></feComponentTransfer><feMerge result="name-mask"><feMergeNode in="name-edge"/><feMergeNode in="name-core"/></feMerge><feComposite in="SourceGraphic" in2="name-mask" operator="in"/></filter></defs>`;
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
  if (predefined && c.pendulum)
    body += image(
      asset("overlay.pendulum"),
      0,
      0,
      813,
      1185,
      'preserveAspectRatio="none" data-card-frame="pendulum"',
    );
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
    `data-text-block="name" ${predefined ? regionAttributes("name") : 'font-family="CardName, Georgia, serif"'}${lightenName ? ' filter="url(#card-name-weight)"' : ""} fill="${["spell", "trap", "xyz"].includes(c.frame) ? "#fff" : "#000"}"` +
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
        rowWidth = c.count * size + Math.max(0, c.count - 1) * gap,
        rowOverflow = c.count > 13 || rowWidth > 680;
      if (c.count != null && !rowOverflow) {
        const star = asset(c.frame === "xyz" ? "icon.rank" : "icon.level"),
          start =
            c.frame === "xyz"
              ? 63
              : predefined
                ? 743 - rowWidth
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
          748,
          174,
          24,
          'text-anchor="end"',
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
    body += label(
      c.frame === "spell" ? "[ SPELL CARD ]" : "[ TRAP CARD ]",
      (textured && c.icon === "normal" ? 735 : 675) +
        (predefined ? tuning.regions.kind.offsetX : 0),
      (textured ? 185 : 172) + (predefined ? tuning.regions.kind.offsetY : 0),
      predefined ? tuning.regions.kind.size : textured ? 40 : 30,
      `data-text-block="kind" text-anchor="end"${predefined ? " " + regionAttributes("kind") : textured ? ' font-weight="bold"' : ""}`,
    );
    if (c.icon && c.icon !== "normal") {
      const icon = asset(`icon.${c.icon}`);
      body += icon
        ? image(icon, 695, textured ? 145 : 133, 54, 54)
        : label(c.icon, 718, 165, 14, 'text-anchor="middle"');
    } else if (!c.icon) body += label("?", 720, 171, 30);
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
          352 * FRAME_SCALE_Y,
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
  const artAperture =
    predefined && c.pendulum
      ? "38,145 510,145 510,491 504,497 44,497 38,491"
      : predefined && c.frame === "link"
        ? "97,148 451,148 482,179 482,532 451,563 97,563 68,534 68,177"
        : null;
  if (artAperture)
    body += `<defs><clipPath id="art-aperture"><polygon transform="scale(${FRAME_SCALE_X} ${FRAME_SCALE_Y})" points="${artAperture}"/></clipPath></defs><g clip-path="url(#art-aperture)">`;
  body += image(
    art,
    ...artBox,
    'preserveAspectRatio="xMidYMid meet" data-card-artwork="true"',
  );
  if (artAperture) body += "</g>";
  if (!art && !predefined)
    body += label(
      "Artwork unavailable locally",
      406,
      textured ? artBox[1] + artBox[3] / 2 : 465,
      26,
      'text-anchor="middle" fill="#e2e8f0"',
    );
  if (c.frame === "link" && predefined) {
    // Highlight only the selected, preprinted sockets; never paint over the frame.
    const points = [
      "248,140 274,124 300,140",
      "464,134 495,134 495,165",
      "490,334 504,355 490,376",
      "495,544 495,575 464,575",
      "248,570 274,586 300,570",
      "54,544 54,575 85,575",
      "59,334 45,355 59,376",
      "54,134 85,134 54,165",
    ];
    for (const direction of c.linkArrows)
      body += `<polygon data-link-arrow="${direction}" transform="scale(${FRAME_SCALE_X} ${FRAME_SCALE_Y})" points="${points[ARROWS.indexOf(direction)]}" fill="#e84b36"/>`;
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
        textured ? 56.5 : 32,
        'text-anchor="middle" fill="#326ca5"',
      ) +
      label(
        c.scaleRight ?? "?",
        textured ? 728 : 733,
        predefined ? 884 : textured ? 792 : 815,
        textured ? 56.5 : 32,
        'text-anchor="middle" fill="#b64949"',
      );
    body += textured
      ? fittedLines(
          c.pendulumEffect || "Pendulum text unavailable",
          129,
          predefined ? 754 : 749,
          555,
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
      c.type || "Type unavailable",
      (textured ? 65 : 72) + (predefined ? tuning.regions.type.offsetX : 0),
      boxY + 33 + (predefined ? tuning.regions.type.offsetY : 0),
      predefined ? tuning.regions.type.size : textured ? 26 : 24,
      'data-text-block="type" ' +
        (predefined ? regionAttributes("type") : 'font-weight="bold"'),
    );
  body += textured
    ? fittedLines(
        c.effect,
        65,
        c.monster ? boxY + 44 : 899,
        685,
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
    const stat = `text-anchor="end" fill="#000000" ${regionAttributes("stats")}`;
    const value = (text, x, width, block) =>
      label(
        text,
        x + r.offsetX,
        tuning.stats.baseline + r.offsetY,
        r.size,
        `data-text-block="${block}" ${stat}` +
          (measureText(text, statsFont.metrics, r.size, r.letterSpacing) > width
            ? ` textLength="${width}" lengthAdjust="spacingAndGlyphs"`
            : ""),
      );
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="813" height="1185" viewBox="0 0 813 1185" role="img"><title>${xml(c.name)}</title><desc>${xml([c.type, c.pendulumEffect, c.effect, ...diagnostics].join("\n"))}</desc><defs>${[...rasterDefinitions.values()].map((raster) => raster.svg).join("")}</defs><style>${fontCss}</style><g font-family="CardBody, Georgia, serif" fill="#171b20">${body}</g></svg>`;
  return { svg, diagnostics: [...new Set(diagnostics)], model: c };
}
module.exports = { normalizeCard, composeCard };

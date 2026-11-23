# Locally supplied monster type font

The user supplied `Yu-Gi-Oh! ITC Stone Serif Small Caps Bold.ttf`. Its embedded
full name is **Yu-Gi-Oh! ITC Stone Serif Bold Small Caps**; its PostScript face is
`StoneSerif-Bold`.

The font's embedded notice reads: "Copyright (c) 1987, 1990, 1992 Adobe Systems
Incorporated. All Rights Reserved. ITC Stone is a registered trademark of
International Typeface Corporation."

The original TTF is kept unchanged at `data/fonts/StoneSerif-BoldSmallCaps.ttf`,
which is ignored by Git. The renderer uses it for monster and Spell/Trap type
lines when the bundled body font is selected. Weight 900 displays the original
Bold outlines; lower settings progressively thin them. Other card text keeps its
selected font. The local SVG and offline tester embed the font for rendering.

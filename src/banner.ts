/** keyring's mark: its name in block letters beside the mark, a ring holding two keys. */

const LETTERS = [
  "██╗  ██╗███████╗██╗   ██╗██████╗ ██╗███╗   ██╗ ██████╗",
  "██║ ██╔╝██╔════╝╚██╗ ██╔╝██╔══██╗██║████╗  ██║██╔════╝",
  "█████╔╝ █████╗   ╚████╔╝ ██████╔╝██║██╔██╗ ██║██║  ███╗",
  "██╔═██╗ ██╔══╝    ╚██╔╝  ██╔══██╗██║██║╚██╗██║██║   ██║",
  "██║  ██╗███████╗   ██║   ██║  ██║██║██║ ╚████║╚██████╔╝",
  "╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝",
];

/**
 * The mark on a 16 by 12 grid: the ring on the left, two keys hanging from
 * it to the right, each with two teeth. The first and last rows are blank so
 * a terminal, drawing two rows a character, gives it as many rows as the
 * letters, the ring centred on them.
 */
export const MARK_PIXELS = [
  "................",
  "..####..........",
  ".#....#.........",
  "#......#########",
  "#......#....#.##",
  "#......#........",
  "#......#........",
  "#......#########",
  "#......#....#.##",
  ".#....#.........",
  "..####..........",
  "................",
];

/** The mark as text, two pixels a character, for terminals; the favicon draws it smooth instead. */
const MARK = Array.from({ length: MARK_PIXELS.length / 2 }, (_, row) =>
  [...MARK_PIXELS[row * 2]!]
    .map((top, col) => {
      const t = top === "#", b = MARK_PIXELS[row * 2 + 1]![col] === "#";
      return t && b ? "█" : t ? "▀" : b ? "▄" : " ";
    })
    .join("")
    .trimEnd(),
);

const WIDTH = Math.max(...LETTERS.map((line) => line.length));
export const WORDMARK = LETTERS.map((line, i) => `${line.padEnd(WIDTH)}  ${MARK[i]}`.trimEnd()).join("\n");

/** keyring's line, verbatim. */
export const TAGLINE = "Every agent's keys on one ring, and only the ones it may use.";
/** What keyring is, in one line. Every place that describes keyring in a line uses this or TAGLINE, verbatim. */
export const SUMMARY = "Keeps the platform's secrets encrypted, and hands each agent session the ones granted to it.";

/** The olive keyring is drawn in: on a light ground, and on a dark one. */
export const OLIVE = { light: "#6b6b1f", dark: "#c9c96a" } as const;

/** The ring, and the two keys it holds: each a shaft with two teeth below its end. */
const RING = '<circle cx="6" cy="8" r="4.5"/>';
const KEYS = '<path d="M10.5 5H23M19 5V7.5M22 5V7.5M10.5 11H23M19 11V13.5M22 11V13.5"/>';

/** The mark drawn smooth, in the current color, for a page's header. */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 24 16"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${RING}${KEYS}</g></svg>`;

/** The mark as the favicon: square, its strokes heavier so it reads at 16 pixels, olive on the tab's light or dark. */
export const MARK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 -4 24 24"><style>svg{--ink:${OLIVE.light}}@media (prefers-color-scheme:dark){svg{--ink:${OLIVE.dark}}}</style><g fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round">${RING}${KEYS}</g></svg>`;

/** Colors only for a terminal that wants them (https://no-color.org). keyring's is olive, beside honed's teal, waypoint's terracotta, jobber's violet and peek's blue. */
export function palette(enabled: boolean) {
  const paint = (code: string) => (text: string) => (enabled ? `\x1b[${code}m${text}\x1b[0m` : text);
  return { mark: paint("38;5;100"), bold: paint("1"), dim: paint("2") };
}

export interface BannerInfo {
  version: string;
  /** Where it listens. */
  url: string;
  /** Where people and agents reach it: its public URL, else `url`. */
  publicUrl: string;
  db: string;
  /** Lines to say before where it listens: the dev key, or that no token is set. */
  notes: string[];
  color: boolean;
}

/** What keyring says when it starts: what it is, and where its API and MCP server are. */
export function banner(b: BannerInfo): string {
  const c = palette(b.color);
  return [
    "",
    c.mark(WORDMARK),
    c.dim(`v${b.version}`),
    "",
    c.bold(TAGLINE),
    SUMMARY,
    "",
    `  ${c.mark("▸")} API       ${b.publicUrl}/api/secrets   docs ${b.publicUrl}/docs/api`,
    `  ${c.mark("▸")} MCP       ${b.publicUrl}/mcp           docs ${b.publicUrl}/docs/mcp`,
    "",
    ...(b.notes.length ? [...b.notes.map((note) => c.bold(note)), ""] : []),
    `  ${c.dim(`listening on ${b.url}, secrets in ${b.db}`)}`,
    `  ${c.dim("Ctrl+C to stop.")}`,
    "",
  ].join("\n");
}

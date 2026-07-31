import * as React from "react";
import { cn } from "@/lib/utils";

// B7 — zero-dependency Markdown renderer for the nightly digest body.
//
// The Hub has NO markdown dependency (checked: no react-markdown / marked /
// remark / markdown-it in package.json or node_modules) and the repo has
// deliberately shed deps. Rather than add one, this renders the exact subset
// the VM digest builder emits (B1-B6): ATX headings, GFM tables with column
// alignment, bullet + ordered lists, blockquotes, horizontal rules,
// paragraphs, and inline code / links / bold / italic.
//
// 🚨 It builds React ELEMENTS — there is no dangerouslySetInnerHTML anywhere
// in this file, so no digest content can inject markup. Links are rendered as
// anchors ONLY when the href is http(s); anything else stays literal text, so
// a javascript: URL can never become a live link.
//
// Deliberate omissions (absent from the digest format): setext headings,
// reference links, images, nested lists, fenced code blocks with language
// highlighting (fences render as preformatted text), HTML passthrough.

/* ---------------------------------------------------------------- inline -- */

const RE_CODE = /`([^`]+)`/;
const RE_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/;
const RE_BOLD = /\*\*([^*]+?)\*\*/;
const RE_ITALIC = /\*([^*\n]+?)\*/;

// Order matters only for ties at the same index: code wins so that a span like
// `notional_usd` is never re-parsed for emphasis.
const INLINE_RULES = [RE_CODE, RE_LINK, RE_BOLD, RE_ITALIC] as const;

function renderInlineMatch(
  ruleIndex: number,
  m: RegExpExecArray,
  key: string,
): React.ReactNode {
  switch (ruleIndex) {
    case 0:
      return (
        <code
          key={key}
          className="rounded border border-border-subtle bg-bg-elevated px-1 py-px font-mono text-[0.85em] text-accent-cyan-soft-strong"
        >
          {m[1]}
        </code>
      );
    case 1:
      return (
        <a
          key={key}
          href={m[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-cyan-soft underline underline-offset-2 transition-colors duration-fast hover:text-accent-cyan-soft-strong focus-visible:outline-2 focus-visible:outline-accent-cyan/60 focus-visible:outline-offset-2"
        >
          {m[1]}
        </a>
      );
    case 2:
      return (
        <strong key={key} className="font-semibold text-fg-primary">
          {parseInline(m[1], key)}
        </strong>
      );
    default:
      return (
        <em key={key} className="italic">
          {parseInline(m[1], key)}
        </em>
      );
  }
}

/** Tokenise one line of inline markdown into React nodes. */
function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let n = 0;

  while (rest.length > 0) {
    let bestIdx = -1;
    let bestRule = -1;
    let bestMatch: RegExpExecArray | null = null;

    // Non-global regexes carry no lastIndex state, so exec always scans from 0.
    for (let r = 0; r < INLINE_RULES.length; r++) {
      const m = INLINE_RULES[r].exec(rest);
      if (m && (bestMatch === null || m.index < bestIdx)) {
        bestIdx = m.index;
        bestRule = r;
        bestMatch = m;
      }
    }

    if (!bestMatch) {
      out.push(rest);
      break;
    }
    if (bestIdx > 0) out.push(rest.slice(0, bestIdx));
    out.push(renderInlineMatch(bestRule, bestMatch, `${keyPrefix}-i${n++}`));
    rest = rest.slice(bestIdx + bestMatch[0].length);
  }

  return out;
}

/* ----------------------------------------------------------------- blocks -- */

type Align = "left" | "center" | "right";

const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const RE_UL = /^\s*[-*+]\s+(.*)$/;
const RE_OL = /^\s*\d+[.)]\s+(.*)$/;
const RE_QUOTE = /^\s*>\s?(.*)$/;
const RE_FENCE = /^\s*```/;
/** A whole paragraph wrapped in underscores — the digest's italic-aside idiom.
 *  Matched at paragraph level only, so snake_case identifiers stay literal. */
const RE_WHOLE_ITALIC = /^_([\s\S]+)_$/;

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|") && line.includes("|");
}

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return t.includes("-") && t.includes("|") && /^[|\s:-]+$/.test(t);
}

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function alignmentsFrom(sep: string): Align[] {
  return splitRow(sep).map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

const ALIGN_CLASS: Record<Align, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const HEADING_CLASS: Record<number, string> = {
  1: "text-h1-ui text-fg-primary mt-6 mb-3 first:mt-0",
  2: "text-h2-ui text-fg-primary mt-6 mb-2 border-b border-border-subtle pb-1.5",
  3: "font-sans text-h3 text-fg-primary mt-5 mb-2",
  4: "text-label-ui text-accent-cyan-soft-strong mt-4 mb-1.5",
  5: "text-label-ui text-fg-muted mt-4 mb-1.5",
  6: "text-label-ui text-fg-muted mt-4 mb-1.5",
};

/** Parse a whole markdown document into React nodes. */
function parseBlocks(md: string): React.ReactNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // blank
    if (line.trim() === "") {
      i++;
      continue;
    }

    // fenced code block — rendered as preformatted text, no highlighting
    if (RE_FENCE.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !RE_FENCE.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence (or run off the end harmlessly)
      out.push(
        <pre
          key={`k${key++}`}
          className="my-3 overflow-x-auto rounded-md border border-border-subtle bg-bg-elevated p-3 font-mono text-caption text-fg-primary"
        >
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // horizontal rule (checked before headings so --- never reads as setext)
    if (RE_HR.test(line)) {
      out.push(
        <hr key={`k${key++}`} className="my-5 border-0 border-t border-border-subtle" />,
      );
      i++;
      continue;
    }

    // heading
    const h = RE_HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      const Tag = `h${Math.min(level + 1, 6)}` as keyof React.JSX.IntrinsicElements;
      out.push(
        <Tag key={`k${key++}`} className={HEADING_CLASS[level] ?? HEADING_CLASS[6]}>
          {parseInline(h[2], `k${key}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // table — a header row immediately followed by a separator row
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      const aligns = alignmentsFrom(lines[i + 1]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const tkey = key++;
      out.push(
        <div
          key={`k${tkey}`}
          className="my-3 overflow-x-auto rounded-md border border-border-subtle"
        >
          <table className="w-full border-collapse text-caption">
            <thead>
              <tr className="bg-bg-elevated">
                {header.map((cell, c) => (
                  <th
                    key={c}
                    scope="col"
                    className={cn(
                      "whitespace-nowrap px-2.5 py-1.5 text-label-ui text-fg-muted",
                      ALIGN_CLASS[aligns[c] ?? "left"],
                    )}
                  >
                    {parseInline(cell, `k${tkey}-h${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className="border-t border-border-subtle">
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={cn(
                        "px-2.5 py-1.5 font-mono text-fg-primary",
                        ALIGN_CLASS[aligns[c] ?? "left"],
                      )}
                    >
                      {parseInline(cell, `k${tkey}-r${r}c${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // blockquote
    if (RE_QUOTE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        buf.push(RE_QUOTE.exec(lines[i])![1]);
        i++;
      }
      out.push(
        <blockquote
          key={`k${key++}`}
          className="my-3 border-l-2 border-accent-cyan-soft/40 bg-bg-elevated/40 py-1.5 pl-3 text-prose-ui text-fg-muted"
        >
          {parseInline(buf.join(" "), `k${key}`)}
        </blockquote>,
      );
      continue;
    }

    // lists
    const listRe = RE_UL.test(line) ? RE_UL : RE_OL.test(line) ? RE_OL : null;
    if (listRe) {
      const items: string[] = [];
      while (i < lines.length && listRe.test(lines[i])) {
        items.push(listRe.exec(lines[i])![1]);
        i++;
      }
      const lkey = key++;
      const ordered = listRe === RE_OL;
      const ListTag = ordered ? "ol" : "ul";
      out.push(
        <ListTag
          key={`k${lkey}`}
          className={cn(
            "my-2 space-y-1 pl-5 text-prose-ui text-fg-primary",
            ordered ? "list-decimal" : "list-disc",
            "marker:text-accent-cyan-soft/70",
          )}
        >
          {items.map((it, n) => (
            <li key={n} className="break-words">
              {parseInline(it, `k${lkey}-l${n}`)}
            </li>
          ))}
        </ListTag>,
      );
      continue;
    }

    // paragraph — consume until a blank line or the start of another block
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !RE_HEADING.test(lines[i]) &&
      !RE_HR.test(lines[i]) &&
      !RE_UL.test(lines[i]) &&
      !RE_OL.test(lines[i]) &&
      !RE_QUOTE.test(lines[i]) &&
      !RE_FENCE.test(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length === 0) {
      // Defensive: nothing consumed means an unhandled shape — emit it raw
      // rather than spinning forever on the same line.
      out.push(
        <p key={`k${key++}`} className="my-2 text-prose-ui text-fg-primary">
          {lines[i]}
        </p>,
      );
      i++;
      continue;
    }

    const text = buf.join(" ").trim();
    const italic = RE_WHOLE_ITALIC.exec(text);
    if (italic) {
      out.push(
        <p
          key={`k${key++}`}
          className="my-2 text-caption-ui italic text-fg-muted"
        >
          {parseInline(italic[1], `k${key}`)}
        </p>,
      );
    } else {
      out.push(
        <p key={`k${key++}`} className="my-2 break-words text-prose-ui text-fg-primary">
          {parseInline(text, `k${key}`)}
        </p>,
      );
    }
  }

  return out;
}

export interface DigestMarkdownProps {
  source: string;
  className?: string;
}

export function DigestMarkdown({ source, className }: DigestMarkdownProps) {
  const nodes = React.useMemo(() => parseBlocks(source ?? ""), [source]);
  return <div className={cn("digest-md", className)}>{nodes}</div>;
}

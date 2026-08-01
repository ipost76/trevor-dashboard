/**
 * D4 — nested-list-survives-print regression check.
 *
 * WHY THIS EXISTS. The D4 prompt carried "nested lists flatten in print" as a
 * defect. It was measured FALSE for the wrong reason: the 2026-07-31 digest
 * body_md contains 167 flat bullets and ZERO indented list lines, so there was
 * nothing to flatten. `22dc252` taught digest-markdown to build a nested list
 * tree, and that support is real — but no digest has ever exercised it, so
 * nobody knows whether it survives the print stylesheet.
 *
 * 🚨 The day the VM digest builder emits its first indented bullet, this check
 * is what says whether the PDF renders it as a nested list or as a flat one.
 * It runs against SYNTHETIC input on purpose — it must not wait for real data.
 *
 * WHAT IT PROVES
 *   1. digest-markdown genuinely nests: an indented bullet becomes a <ul>
 *      INSIDE an <li>, at the right depth, for 1, 2 and 3 levels.
 *   2. The print stylesheet does not flatten it: PRINT_CSS carries the
 *      li > ul / li > ol indent rule and a padding-left on ul/ol, and does NOT
 *      set list-style:none or padding-left:0 on a nested list.
 *   3. NEGATIVE CONTROL: flat input must produce ZERO nested lists, so a
 *      check that always says "nested" cannot pass.
 *
 * WSL has no pytest and this repo has no JS test runner, so this is a
 * __main__-style self-runner:  node tests/test_digest_print_nesting.cjs
 * Exit 0 = all pass, 1 = a failure.
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const REPO = path.resolve(__dirname, "..");
const ts = require(path.join(REPO, "node_modules/typescript"));
const React = require(path.join(REPO, "node_modules/react"));
const ReactDOMServer = require(path.join(REPO, "node_modules/react-dom/server"));

// --- load the REAL component from source, no copy, no re-implementation ----
function loadTs(absFile, extra) {
  const out = ts.transpileModule(fs.readFileSync(absFile, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: absFile,
  }).outputText;
  const m = new Module(absFile, null);
  m.filename = absFile;
  m.paths = Module._nodeModulePaths(path.dirname(absFile));
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (extra && Object.prototype.hasOwnProperty.call(extra, id)) return extra[id];
    if (id.startsWith("@/")) {
      for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        const p = path.join(REPO, "src", id.slice(2) + ext);
        if (fs.existsSync(p)) return loadTs(p);
      }
      throw new Error("unresolved alias " + id);
    }
    if (id.startsWith("./") || id.startsWith("../")) {
      const base = path.resolve(path.dirname(absFile), id);
      for (const ext of ["", ".ts", ".tsx"]) {
        if (fs.existsSync(base + ext) && /\.tsx?$/.test(base + ext)) {
          return loadTs(base + ext);
        }
      }
    }
    return orig(id);
  };
  m._compile(out, absFile);
  return m.exports;
}

const MD = path.join(REPO, "src/components/memory/digest-markdown.tsx");
const SHEET = path.join(REPO, "src/components/memory/digest-download-sheet.tsx");

const { DigestMarkdown } = loadTs(MD);
const sheet = loadTs(SHEET, {
  "react-dom": { createPortal: (c) => c },
  "@/components/ui": new Proxy({}, { get: () => () => null }),
  "lucide-react": new Proxy({}, { get: () => () => null }),
});

const render = (src) =>
  ReactDOMServer.renderToStaticMarkup(React.createElement(DigestMarkdown, { source: src }));

/** Count <ul>/<ol> that are inside an <li> — i.e. genuinely nested. */
function nestedListCount(html) {
  let depth = 0;
  let nested = 0;
  const liDepth = [];
  const re = /<(\/?)(ul|ol|li)\b[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/";
    const tag = m[2];
    if (tag === "li") {
      if (closing) liDepth.pop();
      else liDepth.push(depth);
    } else if (!closing) {
      if (liDepth.length > 0) nested++;
      depth++;
    } else {
      depth--;
    }
  }
  return nested;
}

/** Deepest <ul>/<ol> nesting level reached (1 = a single flat list). */
function maxListDepth(html) {
  let d = 0;
  let max = 0;
  const re = /<(\/?)(?:ul|ol)\b[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] === "/") d--;
    else max = Math.max(max, ++d);
  }
  return max;
}

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

console.log("D4 nested-list-survives-print regression check\n");

// --- 1. the renderer genuinely nests --------------------------------------
console.log("[1] digest-markdown builds a nested tree from indented bullets");

const oneLevel = render("- top a\n  - child a1\n  - child a2\n- top b\n");
check("one level of indent nests", nestedListCount(oneLevel) === 1,
  `nested lists = ${nestedListCount(oneLevel)}, depth = ${maxListDepth(oneLevel)}`);
check("one level reaches depth 2", maxListDepth(oneLevel) === 2);

const twoLevel = render("- a\n  - b\n    - c\n");
check("two levels of indent reach depth 3", maxListDepth(twoLevel) === 3,
  `depth = ${maxListDepth(twoLevel)}`);

const ordered = render("1. a\n   1. b\n");
check("ordered lists nest too", maxListDepth(ordered) >= 2,
  `depth = ${maxListDepth(ordered)}`);

// --- 2. NEGATIVE CONTROL ---------------------------------------------------
console.log("\n[2] negative control — flat input must NOT report nesting");

const flat = render("- a\n- b\n- c\n");
check("flat input produces ZERO nested lists", nestedListCount(flat) === 0,
  `nested lists = ${nestedListCount(flat)}`);
check("flat input stays at depth 1", maxListDepth(flat) === 1,
  `depth = ${maxListDepth(flat)}`);

// The real digest is the live negative control: it is entirely flat today.
const bodyPath = "/home/ghost/tmp/body_md.md";
if (fs.existsSync(bodyPath)) {
  const real = render(fs.readFileSync(bodyPath, "utf8"));
  check("the real 2026-07-31 digest has no nested lists (it is flat)",
    nestedListCount(real) === 0, `nested lists = ${nestedListCount(real)}`);
}

// --- 3. the print stylesheet does not flatten it ---------------------------
console.log("\n[3] PRINT_CSS preserves the indent it is given");

// Render the print document so the check reads the stylesheet that actually
// ships, not a copy of it.
const realUseState = React.useState;
const realUseEffect = React.useEffect;
React.useState = (i) => (i === false ? [true, () => {}] : realUseState(i));
React.useEffect = () => {};
global.document = { body: {}, title: "" };
const printDoc = ReactDOMServer.renderToStaticMarkup(
  React.createElement(sheet.DigestPrintDocument, {
    date: "2026-01-01",
    body: "- top\n  - child\n    - grandchild\n",
  }),
);
React.useState = realUseState;
React.useEffect = realUseEffect;

const cssRaw = (printDoc.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || "";

// 🚨 STRIP CSS COMMENTS BEFORE SCANNING FOR DECLARATIONS.
// D3's harness produced four false failures by matching its own comments
// explaining the code it had REMOVED. This stylesheet documents its defects in
// prose — the D4 table comment contains the literal string
// "Do not restore overflow-wrap: anywhere here" — so a scanner that reads
// comments will report the very declaration the comment forbids as present.
// Every declaration assertion below reads `css`, never `cssRaw`.
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");
check("the print document carries a stylesheet", cssRaw.length > 0, `${cssRaw.length} bytes`);
check("comment stripping actually removed prose (harness self-check)",
  css.length < cssRaw.length && /overflow-wrap:\s*anywhere/.test(cssRaw),
  `raw ${cssRaw.length} -> code ${css.length}; the phrase appears in prose only`);
check("nested list markup survives into the print document",
  maxListDepth(printDoc) === 3, `depth = ${maxListDepth(printDoc)}`);
check("PRINT_CSS keeps a left padding on ul/ol",
  /padding-left:\s*1\.4em\s*!important/.test(css));
check("PRINT_CSS carries the nested li > ul / li > ol rule",
  /li\s*>\s*ul[^{]*,[^{]*li\s*>\s*ol/.test(css));
check("PRINT_CSS never sets list-style: none",
  !/list-style:\s*none/.test(css));
check("PRINT_CSS never zeroes ul/ol padding-left",
  !/padding-left:\s*0(px|em|rem)?\s*(!important)?\s*;[^}]*}/.test(
    (css.match(/(ul|ol)[^{]*\{[^}]*\}/g) || []).join("")));

// --- 4. the D4 print-media guards are present and SCOPED -------------------
console.log("\n[4] D4 print rules exist and are inside @media print");

const mediaPrint = (css.match(/@media print\s*\{[\s\S]*\}/) || [""])[0];
check("color-scheme:light is present", /color-scheme:\s*light/.test(css));
check("color-scheme:light is INSIDE @media print",
  /color-scheme:\s*light/.test(mediaPrint));
check("the body pseudo-element kill is present",
  /body::before[\s\S]{0,80}body::after/.test(css));
check("the pseudo-element kill is INSIDE @media print",
  /body::before[\s\S]{0,80}body::after/.test(mediaPrint));
check("font-variant-ligatures:none is present", /font-variant-ligatures:\s*none/.test(css));
check("overflow-wrap:anywhere is GONE", !/overflow-wrap:\s*anywhere/.test(css));
check("the screen rule still hides the print root",
  /^\s*\.digest-print-root\s*\{\s*display:\s*none;\s*\}/m.test(css));
check("braces balance (a malformed block would leak print CSS to screen)",
  (css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length,
  `${(css.match(/\{/g) || []).length} open / ${(css.match(/\}/g) || []).length} close`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

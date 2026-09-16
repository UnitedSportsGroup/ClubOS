/**
 * Every control is drawn by US, not the browser.
 *
 * A native <select> paints its OPTION PANEL with the operating system. No CSS
 * reaches it — which is why the Sales filters were dark-grey-on-light and
 * unreadable on Dima's machine while looking fine on Daniel's. The
 * `[&>option]:bg-neutral-900` idiom scattered through this codebase is the same
 * dead end as the old `style={{ colorScheme: "dark" }}`: it is trying to
 * restyle somebody else's widget.
 *
 * Use <SelectInput> from @/components/ui/select-input — a drop-in with the same
 * value/onChange contract, so migrating a call site is a rename.
 *
 *   node script/check-native-select.mjs            # report
 *   node script/check-native-select.mjs --strict   # exit 1 on any offender
 *
 * 🔴 Reporting, not failing, until the sweep is finished. A guard that fails the
 * build over 230 pre-existing offenders just gets switched off, and then it is
 * not guarding anything. Flip --strict into deploy.sh when the count is zero.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();
const ROOTS = [join(ROOT, "client/src/pages"), join(ROOT, "client/src/components")];
const STRICT = process.argv.includes("--strict");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

const offenders = [];
for (const root of ROOTS) {
  let files = [];
  try { files = walk(root); } catch { continue; }
  for (const file of files) {
    // The component itself is allowed to know what a <select> is.
    if (/select-input\.tsx$/.test(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/<select[\s>]/.test(line)) offenders.push({ file: relative(ROOT, file), line: i + 1 });
    });
  }
}

if (offenders.length === 0) {
  console.log("✓ no native <select> in the admin — every control is drawn by us");
  process.exit(0);
}

const byFile = new Map();
for (const o of offenders) byFile.set(o.file, (byFile.get(o.file) ?? 0) + 1);
const sorted = [...byFile.entries()].sort((a, b) => b[1] - a[1]);

console.log(`\n${offenders.length} native <select>(s) in ${byFile.size} file(s).`);
console.log(`Their option panel is painted by the OS, so the list is unreadable for`);
console.log(`some people and fine for others. Swap to <SelectInput> — same contract:\n`);
console.log(`    import { SelectInput } from "@/components/ui/select-input";`);
console.log(`    <SelectInput value={x} onChange={(e) => set(e.target.value)}> … </SelectInput>\n`);
for (const [file, n] of sorted.slice(0, 15)) console.log(`  ${String(n).padStart(3)}  ${file}`);
if (sorted.length > 15) console.log(`       … and ${sorted.length - 15} more file(s)`);
console.log();
process.exit(STRICT ? 1 : 0);

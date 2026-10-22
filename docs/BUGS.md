# RTL Live: bugs and corrections

Collected during use. Fix all at the end, together with docs/ACCURACY.md.

## Bugs found

1. **Module name overflows its box.** Typing `module top_module(` alone shows a box with a huge, clipped title ("top_modul"). The box should grow to fit its label, and Fit should not zoom a tiny diagram above 100%.
2. **Badge and drawing disagree.** After deleting most of a synthesized file, the badge says "Stale, fix the error to resynthesize" but the last good diagram is replaced by a structural box. Pick one behavior: keep the last good diagram with "Stale", or show the live structural view with an "Editing" badge.
3. **Vague error messages.** Location is right for mid-line errors (`7458.v:2:29` for `input p1a, p1b, p1c p1d p1e, p1f` was exactly where the missing comma is), but wrong for errors at the end of the file (`1:1` when `);` and `endmodule` were missing). The message is always just "syntax error". It should say what is missing: `missing ','`, `missing ';'`, `missing ');' to close the port list`, `missing endmodule`. Also: while the code has an error, parsing recovery silently drops ports (p1c and p1e vanished from the structural view); show dropped items greyed out instead of hiding them.
4. **Sidebar stuck on the previous file after sleep.** After the Mac slept overnight, switching to `arith_compare.v` kept showing the 7458 diagram ("Synthesized, cached"). The output log had no new lines since the night before. Developer: Reload Window fixed it.
9. **Unsaved new files are ignored.** A new `Untitled-1` file in Plain Text mode containing Verilog shows "Open a Verilog file (.v or .sv)". Either render untitled files that look like Verilog, or show a hint with a one-click "Set language to Verilog" action.
10. **Structural view scatters ports in a grid.** With a syntax error, the structural module box places ports in a 2-column grid (p1a, p1b / p1c, p1y / p2a, p2b / p2y). Inputs should be on the left edge and outputs on the right edge, in declaration order, at normal text size.
11. **Webview fails to load in a newly opened window.** Opening a second VS Code window with `open -a` left the sidebar blank with "Error loading webview provided by 'vejaysuriyaa.rtl-live': Could not register service worker: InvalidStateError: The document is in an invalid state." This is a VS Code webview issue, but the extension should detect a failed load and retry, or show a "Reload to fix" message instead of a blank panel. Likely root cause: two VS Code versions (1.106.3 real app and the 1.143.0 test copy) sharing one user profile, which is a known trigger for this error. Fix the environment (bug 12) and update the real VS Code so only one version is in use.
12. **Test harness shares the real VS Code profile.** Integration tests ran with `~/.vscode/extensions` and the real profile, which let an autosave extension edit fixtures during a test run and leaves two VS Code versions using the same profile. Tests must always use an isolated `--user-data-dir` and `--extensions-dir` in a temp folder.

## Known issues (from NOTES.md)

5. Logical operators (`||`, `&&`, `!`) look the same as bitwise ones (`|`, `&`, `~`).
6. Structural boxes are not overlaid on a stale synthesized diagram.
7. Replicated groups like `{5{a,b,c,d,e}}` expand to one wire per bit.
8. Bus width labels can touch the port chevron on very short wire segments.

## Corrections and accuracy

- Implement docs/ACCURACY.md (RTL view vs gate view, symbol rules, new datapath fixtures, equivalence check).

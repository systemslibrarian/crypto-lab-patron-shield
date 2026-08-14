/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can
 * paint outside its host and the oracle measures it against the host's
 * backdrop, so that ratio is NOT trustworthy — hand-measure before acting.
 *
 * IT IS EMPTY, AND THAT IS THE POINT — this is the terminal state of the
 * ratchet, not an unrun check. The findings the oracle's first run produced
 * were fixed instead of listed:
 *   - `.btn-outline`'s only delineator was a `rgba(255,255,255,.06)` border
 *     (~1.1:1 dark); it now borders with `--color-muted` (>5:1 dark, >3:1
 *     light against the surfaces it sits on).
 *   - `.btn-danger`'s fill and 40%-alpha border both dissolved into the
 *     collusion block (~2:1); its border is now the opaque `--color-danger`.
 *   - the shared bar's `.cl-btn`/`#cl-theme-toggle` border mixed from the
 *     lab's `--accent` (~1.5:1 on the fixed-dark bar); it now mixes from
 *     `--cl-ink`, the accent-independent fix that first landed in
 *     simon-period.
 *
 * A run with `NT_BASELINE_CAPTURE=1` set prints every finding through this
 * same path and asserts nothing, which is how this file is regenerated.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {};

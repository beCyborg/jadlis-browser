// Cookie refusal for the agent's Chrome profiles: DuckDuckGo autoconsent (action optOut) as the content script of an
// unpacked extension (manifest: MAIN world, document_start, all frames). Built by build.sh into
// ~/.local/share/jadlis-browser/autoconsent-ext/autoconsent.js; the skip list comes from
// ~/.config/jadlis/adblock-skip-hosts.txt at build time.
// An extension and not a driver --init-script on purpose: under Patchright any driver init script makes the driver
// intercept every document load, which bot detectors report as documentInterception (live run 2026-11-10).
// Pattern: node_modules/@duckduckgo/autoconsent/standalone/content.ts, but
//  - own config: optOut, prehide, short detectRetries, heuristics off (library default);
//  - skip list: on a listed host (or inside a frame whose ancestor is one) the script returns at once;
//  - no window globals: messages go into the DOM attribute data-ac-result of this frame's <html>,
//    readable from any world (main or isolated) and from CDP.
import AutoConsent from '../node_modules/@duckduckgo/autoconsent/lib/web';
import { filterCompactRules, type IndexedCMPRuleset } from '../node_modules/@duckduckgo/autoconsent/lib/encoding';
import type { ContentScriptMessage } from '../node_modules/@duckduckgo/autoconsent/lib/messages';
import type { Config, RuleBundle } from '../node_modules/@duckduckgo/autoconsent/lib/types';
import compactRules from '../node_modules/@duckduckgo/autoconsent/rules/compact-rules.json';
import SKIP from '../build/skip-hosts.json';

const ATTR = 'data-ac-result';
declare const AUTOCONSENT_VERSION: string; // set by build.sh (--define) from the installed package
const VERSION = AUTOCONSENT_VERSION;
const DETECT_RETRIES = 6; // ~500 ms + one DOM mutation per retry → about 3 s on a page without a CMP
// findCmp() waits for a DOM mutation between retries with a fixed 60 s timeout (lib/dom-actions.ts:228, lib/web.ts:303),
// so on a page that went quiet detection ended only after ~62 s (unian.ua, 10.11). Cap that one wait.
const QUIET_MS = 4000;

const skipped = (host: string) => (SKIP as string[]).some((s) => host === s || host.endsWith('.' + s));

(() => {
  try {
    if (skipped(location.hostname)) return;
    const anc = (location as any).ancestorOrigins as DOMStringList | undefined;
    if (anc) for (let i = 0; i < anc.length; i++) { try { if (skipped(new URL(anc[i]).hostname)) return; } catch {} }
  } catch {}
  const html = () => document.documentElement;
  if (html() && html().hasAttribute(ATTR)) return; // already running in this document
  const t0 = performance.now();
  const rec: { v: string; top: boolean; t0: number; msgs: any[]; lifecycle?: string; err?: string } = {
    v: VERSION, top: window.top === window, t0: Math.round(performance.timeOrigin + t0), msgs: [],
  };
  const flush = () => {
    const el = html();
    if (el) el.setAttribute(ATTR, JSON.stringify(rec));
    else document.addEventListener('DOMContentLoaded', flush, { once: true });
  };
  const send = async (m: ContentScriptMessage) => {
    const t = Math.round(performance.now() - t0);
    if (m.type === 'report') {
      const lc = (m as any).state?.lifecycle;
      if (lc && lc !== rec.lifecycle) { rec.lifecycle = lc; rec.msgs.push({ t, type: 'state', lifecycle: lc }); flush(); }
      return;
    }
    const o: any = { t, type: m.type };
    for (const k of ['cmp', 'result', 'isCosmetic', 'duration', 'totalClicks']) if ((m as any)[k] !== undefined) o[k] = (m as any)[k];
    if (m.type === 'autoconsentError') o.details = String(JSON.stringify((m as any).details)).slice(0, 200);
    if (m.type === 'eval') o.note = 'eval request (unexpected with isMainWorld)';
    rec.msgs.push(o);
    flush();
  };
  try {
    const config: Partial<Config> = {
      enabled: true,
      autoAction: 'optOut',
      enablePrehide: true,
      enableCosmeticRules: true,
      detectRetries: DETECT_RETRIES,
      isMainWorld: true,
      prehideTimeout: 2000,
      logs: { lifecycle: false, rulesteps: false, detectionsteps: false, evals: false, errors: false, messages: false, waits: false },
    };
    const rules: RuleBundle = {
      autoconsent: [],
      compact: filterCompactRules(compactRules as IndexedCMPRuleset, { url: location.href, mainFrame: window.top === window }),
    };
    const consent = new AutoConsent(send);
    const da = (consent as any).domActions;
    if (da && typeof da.waitForMutation === 'function') {
      const orig = da.waitForMutation.bind(da);
      da.waitForMutation = (sel: any, timeout?: number) => orig(sel, timeout ?? (sel === 'html' ? QUIET_MS : undefined));
    }
    consent.initialize(config, rules);
    rec.lifecycle = 'initialized';
  } catch (e) {
    rec.err = String((e as Error)?.message || e).slice(0, 200);
  }
  flush();
})();

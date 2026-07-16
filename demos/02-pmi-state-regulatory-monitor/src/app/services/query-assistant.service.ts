import { Injectable } from '@angular/core';

import type { PricingSignal } from '../../../rayfin/data/schema';
import { revenueAtRisk, type RevenueSignal } from './revenue.service';
import {
  PRICING_ACTIONS,
  US_STATE_NAMES,
  type PricingAction,
  type ProductCode,
} from './constants';

export interface AskRow {
  code: string;
  label: string;
  value: string;
}

export interface AskResult {
  /** One-line headline answer. */
  answer: string;
  /** Optional supporting rows (state list, metric breakdown). */
  rows: AskRow[];
  /** State codes referenced (for click-through chips). */
  states: string[];
  /** True when nothing matched and we returned guidance. */
  fallback: boolean;
}

interface Intent {
  program?: ProductCode;
  action?: PricingAction;
  state?: string;
  metric?: 'tax' | 'revenue' | 'pending' | 'count';
  topN?: number;
}

const PROGRAMS: ProductCode[] = ['VEEV', 'ZYN', 'IQOS'];

// Keyword → action. First hit wins (checked in this order).
const ACTION_HINTS: [RegExp, PricingAction][] = [
  [/\b(delist|banned?|ban)\b/i, 'delist_banned'],
  [/\b(restrict|assortment)\b/i, 'restricted_assortment'],
  [/\b(watch|pending|monitor)\b/i, 'watch_pending'],
  [/\b(tax|excise)\b/i, 'adjust_for_tax'],
  [/\b(freely|free)\b/i, 'price_freely'],
];

/**
 * Deterministic, offline "ask the data" assistant. Parses a natural-language
 * query into a (program, action, state, metric) intent and answers straight
 * from the Pricing Signal set + the synthetic revenue model. No LLM, no network
 * — the demo's static host has no guaranteed model backend, so this rule-based
 * engine IS the implementation (not a fallback).
 */
@Injectable({ providedIn: 'root' })
export class QueryAssistantService {
  readonly examples: readonly string[] = [
    'Where should I delist ZYN?',
    'Which states have pending bills?',
    'Top 5 states by excise tax',
    'Total revenue at risk for VEEV',
  ];

  ask(query: string, signals: readonly PricingSignal[]): AskResult {
    const q = query.trim();
    if (!q) return this.guidance('Ask about a program, action, state or metric.');
    const intent = this.parse(q);

    if (intent.metric === 'revenue') return this.answerRevenue(intent, signals);
    if (intent.metric === 'pending') return this.answerPending(intent, signals);
    if (intent.metric === 'tax') return this.answerTax(intent, signals);
    if (intent.action) return this.answerAction(intent, signals);
    if (intent.metric === 'count') return this.answerCount(intent, signals);
    if (intent.program || intent.state) return this.answerScopeSummary(intent, signals);
    return this.guidance(`I couldn't map “${q}” to the data.`);
  }

  // ── Parsing ────────────────────────────────────────────────────────────
  private parse(q: string): Intent {
    const lower = q.toLowerCase();
    const intent: Intent = {};

    intent.program = PROGRAMS.find((p) => new RegExp(`\\b${p}\\b`, 'i').test(q));
    intent.state = this.matchState(q);

    for (const [re, action] of ACTION_HINTS) {
      if (re.test(q)) {
        intent.action = action;
        break;
      }
    }

    if (/\b(revenue|at[-\s]?risk|exposure|\$)\b/i.test(q)) intent.metric = 'revenue';
    else if (/\bpending\b/i.test(q)) intent.metric = 'pending';
    else if (/\b(tax|excise)\b/i.test(q)) intent.metric = 'tax';
    else if (/\b(how many|count|number of)\b/i.test(q)) intent.metric = 'count';

    const top = lower.match(/top\s+(\d+)/);
    if (top) intent.topN = Math.max(1, Number(top[1]));
    else if (/\btop\b/i.test(q)) intent.topN = 5;

    // "pending" as a metric outranks the watch_pending action hint for clarity.
    if (intent.metric === 'pending') intent.action = undefined;
    // "tax"/"revenue" metric outranks the adjust_for_tax action hint unless the
    // user explicitly said an action verb.
    if ((intent.metric === 'tax' || intent.metric === 'revenue') &&
        intent.action === 'adjust_for_tax' && !/\badjust\b/i.test(q)) {
      intent.action = undefined;
    }
    return intent;
  }

  private matchState(q: string): string | undefined {
    // 2-letter code (word-bounded, excluding the program tokens).
    const code = q.toUpperCase().match(/\b([A-Z]{2})\b/);
    if (code && US_STATE_NAMES[code[1]] && !PROGRAMS.includes(code[1] as ProductCode)) {
      return code[1];
    }
    // Full state name.
    for (const [c, name] of Object.entries(US_STATE_NAMES)) {
      if (new RegExp(`\\b${name}\\b`, 'i').test(q)) return c;
    }
    return undefined;
  }

  // ── Scope helper ───────────────────────────────────────────────────────
  private scoped(intent: Intent, signals: readonly PricingSignal[]): PricingSignal[] {
    return signals.filter((s) => {
      if (intent.program && s.product_code !== intent.program) return false;
      if (intent.state && s.state !== intent.state) return false;
      return true;
    });
  }

  private scopeLabel(intent: Intent): string {
    const parts: string[] = [];
    if (intent.program) parts.push(intent.program);
    if (intent.state) parts.push(US_STATE_NAMES[intent.state] ?? intent.state);
    return parts.length ? ` for ${parts.join(' in ')}` : '';
  }

  // ── Answers ────────────────────────────────────────────────────────────
  private answerRevenue(intent: Intent, signals: readonly PricingSignal[]): AskResult {
    const scope = { state: intent.state, product: intent.program };
    const atRisk = revenueAtRisk(signals as readonly RevenueSignal[], scope);
    const scopedRows = this.scoped(intent, signals).filter(
      (s) => s.pricing_action !== 'price_freely'
    );
    const states = [...new Set(scopedRows.map((s) => s.state))];
    return {
      answer: `Revenue at risk${this.scopeLabel(intent)}: ${money(atRisk)} across ${states.length} state(s).`,
      rows: [
        { code: '', label: 'Revenue at risk', value: money(atRisk) },
        { code: '', label: 'At-risk signals', value: String(scopedRows.length) },
      ],
      states,
      fallback: false,
    };
  }

  private answerPending(intent: Intent, signals: readonly PricingSignal[]): AskResult {
    const pending = this.scoped(intent, signals).filter((s) => s.has_pending);
    const states = [...new Set(pending.map((s) => s.state))];
    const watch = this.scoped(intent, signals).filter(
      (s) => s.pricing_action === 'watch_pending'
    ).length;
    return {
      answer: `${states.length} state(s) carry a pending bill${this.scopeLabel(intent)}; ${watch} resolve to a “watch pending” action (a stricter rule outranks the rest).`,
      rows: pending.map((s) => ({
        code: s.state,
        label: `${US_STATE_NAMES[s.state] ?? s.state} · ${s.product_code}`,
        value: PRICING_ACTIONS[s.pricing_action].label,
      })),
      states,
      fallback: false,
    };
  }

  private answerTax(intent: Intent, signals: readonly PricingSignal[]): AskResult {
    const taxed = this.scoped(intent, signals)
      .filter((s): s is PricingSignal & { tax_burden: number } =>
        typeof s.tax_burden === 'number' && s.tax_burden > 0
      )
      .sort((a, b) => b.tax_burden - a.tax_burden);
    const limit = intent.topN ?? taxed.length;
    const top = taxed.slice(0, limit);
    return {
      answer: `Top ${top.length} state(s) by excise tax${this.scopeLabel(intent)}:`,
      rows: top.map((s) => ({
        code: s.state,
        label: `${US_STATE_NAMES[s.state] ?? s.state} · ${s.product_code}`,
        value: `${s.tax_burden.toFixed(1)}%`,
      })),
      states: top.map((s) => s.state),
      fallback: false,
    };
  }

  private answerAction(intent: Intent, signals: readonly PricingSignal[]): AskResult {
    const action = intent.action as PricingAction;
    const rows = this.scoped(intent, signals).filter((s) => s.pricing_action === action);
    const states = [...new Set(rows.map((s) => s.state))];
    const label = PRICING_ACTIONS[action].label.toLowerCase();
    if (rows.length === 0) {
      return {
        answer: `No signals recommend “${label}”${this.scopeLabel(intent)}.`,
        rows: [],
        states: [],
        fallback: false,
      };
    }
    return {
      answer: `${rows.length} signal(s) across ${states.length} state(s) recommend “${label}”${this.scopeLabel(intent)}:`,
      rows: rows.map((s) => ({
        code: s.state,
        label: `${US_STATE_NAMES[s.state] ?? s.state} · ${s.product_code}`,
        value: s.sellable ? 'Sellable' : 'Blocked',
      })),
      states,
      fallback: false,
    };
  }

  private answerCount(intent: Intent, signals: readonly PricingSignal[]): AskResult {
    const rows = this.scoped(intent, signals);
    return {
      answer: `${rows.length} signal(s)${this.scopeLabel(intent)}.`,
      rows: this.actionBreakdown(rows),
      states: [...new Set(rows.map((s) => s.state))],
      fallback: false,
    };
  }

  private answerScopeSummary(intent: Intent, signals: readonly PricingSignal[]): AskResult {
    const rows = this.scoped(intent, signals);
    if (rows.length === 0) {
      return this.guidance(`No signals found${this.scopeLabel(intent)}.`);
    }
    return {
      answer: `${rows.length} signal(s)${this.scopeLabel(intent)}, by action:`,
      rows: this.actionBreakdown(rows),
      states: [...new Set(rows.map((s) => s.state))],
      fallback: false,
    };
  }

  private actionBreakdown(rows: PricingSignal[]): AskRow[] {
    return Object.keys(PRICING_ACTIONS)
      .map((a) => {
        const action = a as PricingAction;
        const n = rows.filter((s) => s.pricing_action === action).length;
        return { code: '', label: PRICING_ACTIONS[action].label, value: String(n) };
      })
      .filter((r) => r.value !== '0');
  }

  private guidance(msg: string): AskResult {
    return {
      answer: msg,
      rows: this.examples.map((e) => ({ code: '', label: 'Try', value: e })),
      states: [],
      fallback: true,
    };
  }
}

function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

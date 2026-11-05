// "Show when" rules: decide whether a widget is on or off. PURE: no page, no Home Assistant, no timers, so it runs in Node too
// with a frozen clock. The engine (engine.js) feeds it the facts and acts on the answer.
//
// A rule is   { "match": "all" | "any", "conditions": [ ... ] }   (match defaults to "all"). A condition is one of:
//   { "kind": "has_content", "widget": "<id>" }        another widget is showing something
//   { "kind": "empty",       "widget": "<id>" }        another widget is showing nothing (this is how a fallback takes its place)
//   { "kind": "entity", "slot": "when_door", "test": "is" | "is_not" | "above" | "below" | "unavailable", "value": ... }
//   { "kind": "time", "from": "07:00", "to": "22:00" }  a window of the day; "from" later than "to" runs through midnight
//   { "kind": "days", "days": ["mon", "tue"] }          days of the week
// An entity condition NEVER holds an entity id. It names a slot ("when_door"); the entity itself is kept in the bindings, next to the
// widget's other entities, so a pane can still be shared or exported without anyone's house in it.
//
// The older `flow.show_if: <widget id>` is the same thing as a "has_content" condition and keeps working: see conditionsOf().

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const KINDS = ['has_content', 'empty', 'entity', 'time', 'days'];
export const TESTS = ['is', 'is_not', 'above', 'below', 'unavailable'];
export const MAX_CONDITIONS = 8;                    // per widget; keeps checking and evaluating cheap

const LONG_DAY = { Monday: 'mon', Tuesday: 'tue', Wednesday: 'wed', Thursday: 'thu', Friday: 'fri', Saturday: 'sat', Sunday: 'sun' };

// ---------------------------------------------------------------- time

/** "07:30" -> 450 (minutes since midnight), or NaN if it is not a time. */
export function toMinutes(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm));
  return m ? (+m[1]) * 60 + (+m[2]) : NaN;
}

/**
 * Is `minutes` (since midnight) inside the window that starts at `from` and ends at `to`? The start counts, the end does not, so
 * "07:00 to 22:00" is off at exactly 22:00. When `from` is later than `to` the window runs through midnight ("22:00 to 06:00" is the
 * night). Equal times are not a window; they count as the whole day (the checker refuses them so nobody gets that by accident).
 */
export function inTimeWindow(from, to, minutes) {
  const a = toMinutes(from), b = toMinutes(to);
  if (isNaN(a) || isNaN(b) || a === b) return a === b && !isNaN(a);
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

/** The facts about "now" a rule needs, in the DISPLAY's timezone. `time` is util.makeTime(zone); `date` defaults to now. */
export function clockOf(time, date = new Date()) {
  const p = time.parts(date);
  return { minutes: p.h * 60 + p.mi, day: LONG_DAY[p.wd] || null };
}

/** Milliseconds until a moment just after the next minute starts (time rules only change on the minute). */
export function nextMinuteDelay(nowMs) {
  return 60000 - (nowMs % 60000) + 200;
}

// ---------------------------------------------------------------- entity states

const isBadState = (s) => s === 'unavailable' || s === 'unknown';

/**
 * Does an entity's state meet an entity condition? `st` is the Home Assistant state object, `null` when the entity does not exist, or
 * `undefined` when it has not been fetched yet (or nothing is bound to the slot). Not-yet-known is "no" for EVERY test, so nothing
 * flashes on while things load, and a widget whose entity was never chosen simply stays off.
 */
export function matchesState(cond, st) {
  if (st === undefined) return false;
  if (cond.test === 'unavailable') return st === null || isBadState(String(st.state));
  if (st === null) return false;
  const value = String(st.state);
  if (cond.test === 'above' || cond.test === 'below') {
    const t = value.trim(), n = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : NaN, limit = Number(cond.value);   // the whole state must be a number
    if (!isFinite(n) || !isFinite(limit)) return false;
    return cond.test === 'above' ? n > limit : n < limit;
  }
  const wanted = (Array.isArray(cond.value) ? cond.value : [cond.value]).map((v) => String(v).toLowerCase());
  const is = wanted.includes(value.toLowerCase());
  return cond.test === 'is' ? is : !is;
}

// ---------------------------------------------------------------- evaluating

/**
 * env = {
 *   entityState(slot) -> state object | null | undefined   the state of the entity bound to that slot of THIS widget
 *   hasContent(widgetId) -> boolean                          is that widget showing something right now
 *   clock -> { minutes, day }                                see clockOf()
 * }
 */
export function evaluateCondition(cond, env) {
  switch (cond.kind) {
    case 'has_content': return !!env.hasContent(cond.widget);
    case 'empty': return !env.hasContent(cond.widget);
    case 'entity': return matchesState(cond, env.entityState(cond.slot));
    case 'time': return !!env.clock && inTimeWindow(cond.from, cond.to, env.clock.minutes);
    case 'days': return !!env.clock && (cond.days || []).includes(env.clock.day);
    default: return false;                    // a kind this version does not know never switches a widget on
  }
}

/** A whole rule. No conditions at all means "always". */
export function evaluateRule(rule, env) {
  const list = (rule && rule.conditions) || [];
  if (!list.length) return true;
  return rule.match === 'any' ? list.some((c) => evaluateCondition(c, env)) : list.every((c) => evaluateCondition(c, env));
}

/** The older flow.show_if as a condition list entry (or null). */
function legacyCondition(w) {
  return w && w.flow && w.flow.show_if ? { kind: 'has_content', widget: w.flow.show_if } : null;
}

/** Every condition that applies to a widget: its show_when ones, plus flow.show_if shown as the "has content" condition it is. */
export function conditionsOf(w) {
  const legacy = legacyCondition(w);
  return [...(legacy ? [legacy] : []), ...((w && w.show_when && w.show_when.conditions) || [])];
}

/** Should this widget be on? flow.show_if AND the show_when rule must both allow it (a widget with neither is always on). */
export function widgetShouldShow(w, env) {
  const legacy = legacyCondition(w);
  if (legacy && !evaluateCondition(legacy, env)) return false;
  return evaluateRule(w && w.show_when, env);
}

/** Ids of the widgets this widget's rule looks at. */
export function dependencies(w) {
  return [...new Set(conditionsOf(w).filter((c) => c.widget).map((c) => c.widget))];
}

/** Does the widget have any rule at all (show_when, or the older flow.show_if)? */
export function usesRules(w) {
  return conditionsOf(w).length > 0;
}

/** Does the rule depend on the clock (so the engine needs its once-a-minute check)? */
export function usesClock(w) {
  return conditionsOf(w).some((c) => c.kind === 'time' || c.kind === 'days');
}

/** The distinct slot names of the entity conditions of this widget. */
export function entitySlots(w) {
  return [...new Set(conditionsOf(w).filter((c) => c.kind === 'entity').map((c) => c.slot))];
}

/**
 * Rules that wait on each other ("A shows when B has content, B shows when A has content") cannot settle. Returns each loop found as a
 * list of widget ids that ends where it began, e.g. ['a', 'b', 'a']. Empty means no loops. A widget that names itself is a loop.
 */
export function findRuleLoops(widgets) {
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const state = new Map(), loops = [];
  const visit = (id, trail) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { loops.push([...trail.slice(trail.indexOf(id)), id]); return; }
    state.set(id, 1);
    dependencies(byId.get(id)).filter((d) => byId.has(d)).forEach((d) => visit(d, [...trail, id]));
    state.set(id, 2);
  };
  widgets.forEach((w) => visit(w.id, []));
  return loops;
}

// ---------------------------------------------------------------- editing helpers (used by the builder)

/** A copy of the widget with flow.show_if moved into show_when as an ordinary "has content" condition (same behaviour). */
export function foldShowIf(widget) {
  const legacy = legacyCondition(widget);
  if (!legacy) return widget;
  const w = JSON.parse(JSON.stringify(widget));
  delete w.flow.show_if;
  const rule = w.show_when || { match: 'all', conditions: [] };
  rule.conditions = [legacy, ...rule.conditions];
  w.show_when = rule;
  return w;
}

/** The widgets with every reference to `id` taken out of their rules (used when a widget is deleted). A rule left empty is removed. */
export function withoutReferences(widgets, id) {
  return widgets.map((w) => {
    const rule = w.show_when;
    if (!rule || !rule.conditions.some((c) => c.widget === id)) return w;
    const next = { ...w };
    const conditions = rule.conditions.filter((c) => c.widget !== id);
    if (conditions.length) next.show_when = { ...rule, conditions }; else delete next.show_when;
    return next;
  });
}

/** The first free slot name for a new entity condition on this widget: when_1, when_2, ... */
export function freeSlot(widget) {
  const used = new Set(entitySlots(widget));
  let n = 1;
  while (used.has('when_' + n)) n++;
  return 'when_' + n;
}

/** A new condition of the given kind with sensible starting values. */
export function newCondition(kind, widget, otherIds) {
  switch (kind) {
    case 'has_content': case 'empty': return { kind, widget: otherIds[0] };
    case 'entity': return { kind, slot: freeSlot(widget), test: 'is', value: 'on' };
    case 'time': return { kind, from: '07:00', to: '22:00' };
    default: return { kind: 'days', days: ['sat', 'sun'] };
  }
}

/** A plain-language sentence for a condition. `nameOf(widgetId)` and `entityOf(slot)` give friendly names. */
export function describeCondition(c, nameOf = (id) => id, entityOf = () => null) {
  switch (c.kind) {
    case 'has_content': return nameOf(c.widget) + ' has something to show';
    case 'empty': return nameOf(c.widget) + ' has nothing to show';
    case 'entity': {
      const who = entityOf(c.slot) || 'an entity you have not chosen yet';
      const v = Array.isArray(c.value) ? c.value.join(' or ') : c.value;
      if (c.test === 'is') return who + ' is ' + v;
      if (c.test === 'is_not') return who + ' is not ' + v;
      if (c.test === 'above') return who + ' is above ' + v;
      if (c.test === 'below') return who + ' is below ' + v;
      return who + ' is unavailable';
    }
    case 'time': return 'the time is between ' + c.from + ' and ' + c.to + (toMinutes(c.from) > toMinutes(c.to) ? ' (through midnight)' : '');
    case 'days': return 'it is ' + (c.days || []).map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(', ');
    default: return 'an unknown rule';
  }
}

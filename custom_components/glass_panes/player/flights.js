// The flights widget (v0.13): the planes over your home, from a flight-tracking integration the person has installed from HACS. Loaded
// only when a pane uses it (see LAZY in widgets.js). The display never calls a flight service itself (those services don't allow a
// web page to ask them anyway); Home Assistant's integration does the asking and the widget reads its sensors.
//
// Understood, as tested against the integrations themselves (Nov 2026):
//   FlightRadar24 (AlexandrErohin/home-assistant-flightradar24): sensor "Current in area" with attribute flights = [flight objects]
//      (flight_number, callsign, airline_short, airport_origin_city/code_iata, airport_destination_..., altitude ft, ground_speed kt,
//      heading, distance km, aircraft_model, latitude, longitude, on_ground) and bounds (the box around home).
//   Flights Above (Tobhs/flights_above): sensor "Flights Overhead" with attributes latitude, longitude (home), radius_km, radar =
//      [{callsign, distance_km, bearing, heading, altitude_ft}] and flights = [{callsign, origin, destination, route_line, distance_km}],
//      plus one sensor per plane ("Flight 1" ...) whose state is the callsign and whose attributes carry the details.

import { clear, el, okState } from './util.js';

const KM_PER_NM = 1.852;
const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const RAD = Math.PI / 180;

/** The compass bearing (degrees) and distance (km) from one point to another. */
export function bearingTo(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return { bearing: (Math.atan2(y, x) / RAD + 360) % 360, km: 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) };
}

/**
 * Every plane the bound sensors know about, as one tidy list sorted nearest first, and the home point when a sensor gives one:
 * { home: {lat, lon} | null, radius_km, planes: [{ id, callsign, flight, airline, from, to, fromCity, toCity, alt (ft), speed (kt),
 * heading, km, bearing, aircraft, photo, ground }] }. Planes known to more than one sensor are merged, the richer record winning.
 */
export function planesFrom(states) {
  const byId = new Map();
  let home = null, radius = null;
  const add = (p) => {
    const id = String(p.callsign || p.flight || p.id || '').trim().toUpperCase();
    if (!id) return;
    const old = byId.get(id) || {};
    const merged = { ...old };
    for (const [k, v] of Object.entries(p)) if (v !== null && v !== undefined && v !== '') merged[k] = v;
    merged.id = id;
    byId.set(id, merged);
  };
  for (const s of states) {
    if (!okState(s) || !s.attributes) continue;
    const a = s.attributes;
    if (num(a.latitude) !== null && num(a.longitude) !== null && Array.isArray(a.radar)) {
      home = { lat: num(a.latitude), lon: num(a.longitude) };            // Flights Above's count sensor knows where home is
      radius = num(a.radius_km);
    }
    const bounds = typeof a.bounds === 'string' ? a.bounds.split(',') : a.bounds;
    if (Array.isArray(bounds) && bounds.length === 4 && !home) {
      // FlightRadar24's area, "top,bottom,left,right" (a string in v2.5); home is its middle
      const [t, b, l, r] = bounds.map(num);
      if ([t, b, l, r].every((x) => x !== null)) { home = { lat: (t + b) / 2, lon: (l + r) / 2 }; radius = Math.abs(t - b) * 111 / 2; }
    }
    if (Array.isArray(a.flights)) {
      a.flights.forEach((f) => {
        if (!f || typeof f !== 'object') return;
        if (f.flight_number !== undefined || f.airport_origin_code_iata !== undefined || f.aircraft_model !== undefined) {
          add({                                                         // FlightRadar24 flight object
            callsign: f.callsign, flight: f.flight_number, airline: f.airline_short || f.airline,
            from: f.airport_origin_code_iata, to: f.airport_destination_code_iata, fromCity: f.airport_origin_city, toCity: f.airport_destination_city,
            alt: num(f.altitude), speed: num(f.ground_speed), heading: num(f.heading), km: num(f.distance), aircraft: f.aircraft_model,
            photo: f.aircraft_photo_small, lat: num(f.latitude), lon: num(f.longitude), ground: f.on_ground === 1 || f.on_ground === true,
          });
        } else {
          add({ callsign: f.callsign, from: f.origin, to: f.destination, km: num(f.distance_km) });   // Flights Above summary
        }
      });
    }
    if (Array.isArray(a.radar)) {
      a.radar.forEach((r) => add({ callsign: r.callsign, km: num(r.distance_km), bearing: num(r.bearing), heading: num(r.heading), alt: num(r.altitude_ft) }));
    }
    if (a.in_range === true && s.state && s.state !== 'unknown') {
      add({                                                             // a Flights Above "Flight n" sensor
        callsign: s.state, from: a.origin_iata || a.origin_icao, to: a.destination_iata || a.destination_icao, fromCity: a.origin_name, toCity: a.destination_name,
        alt: num(a.altitude_ft), speed: num(a.ground_speed_kmh) !== null ? Math.round(num(a.ground_speed_kmh) / KM_PER_NM) : null,
        heading: num(a.heading), km: num(a.distance_km), aircraft: a.aircraft_type, lat: num(a.latitude), lon: num(a.longitude),
      });
    }
  }
  const planes = [...byId.values()];
  if (home) planes.forEach((p) => {
    if (p.lat !== null && p.lat !== undefined && p.lon !== null && p.lon !== undefined) {
      const g = bearingTo(home.lat, home.lon, p.lat, p.lon);
      if (p.bearing === undefined || p.bearing === null) p.bearing = g.bearing;
      if (p.km === undefined || p.km === null) p.km = g.km;
    }
  });
  planes.sort((x, y) => (x.km ?? 1e9) - (y.km ?? 1e9));
  return { home, radius_km: radius, planes: planes.filter((p) => !p.ground) };
}

// a plane seen from above, nose up, on a 24-unit grid (our own drawing)
const PLANE = 'M12 2c.8 0 1.3.7 1.3 1.6v5.6l7.7 4.4v2l-7.7-2.3v4.8l2.2 1.6v1.6L12 20.4l-3.5.9v-1.6l2.2-1.6v-4.8L3 15.6v-2l7.7-4.4V3.6C10.7 2.7 11.2 2 12 2z';
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs, parent) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};
const planeIcon = (size, heading, color) => {
  const s = svgEl('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true' });
  s.style.cssText = 'display:block;flex:none;transform:rotate(' + Math.round(heading || 0) + 'deg)';
  svgEl('path', { d: PLANE, fill: color || 'currentColor' }, s);
  return s;
};
// heights in feet, the unit every pilot and flight app uses, rounded to the nearest 100 (no "FL380" jargon)
const ft = (v) => (v === null || v === undefined ? '' : (Math.round(v / 100) * 100).toLocaleString('en-US') + ' ft');
const speedText = (kt, units) => (!kt ? '' : units === 'mi' ? Math.round(kt * 1.15078) + ' mph' : Math.round(kt * 1.852) + ' km/h');
/** "Boeing 777-36N(ER)" -> "Boeing 777", "Airbus A380-861" -> "Airbus A380": the factory variant codes mean nothing at a glance. */
export function aircraftName(model) {
  return String(model || '').replace(/\s*\(.*?\)\s*$/, '').replace(/-[0-9A-Z]{2,4}$/, '').trim();
}
const route = (p) => [p.fromCity || p.from, p.toCity || p.to].every(Boolean) ? (p.fromCity || p.from) + ' → ' + (p.toCity || p.to) : (p.from && p.to ? p.from + ' → ' + p.to : '');
const dist = (km, units) => (km === null || km === undefined ? '' : units === 'mi' ? (km / 1.609).toFixed(km < 16 ? 1 : 0) + ' mi' : km.toFixed(km < 10 ? 1 : 0) + ' km');

/**
 * The plane to feature: the nearest one, unless a plane almost as close has its route known (Flights Above looks up routes for only a
 * few planes, so the very nearest can be a bare call sign).
 */
export function featured(planes) {
  const near = planes[0];
  if (!near || route(near)) return near;
  const within = (near.km || 0) * 2 + 3;
  return planes.find((x) => route(x) && (x.km ?? 1e9) <= within) || near;
}

/** The plane as a card: where it's going (the headline), the airline and flight, then aircraft, height, speed and how far. */
function overhead(ctx, data, o) {
  const p = featured(data.planes), fs = ctx.style.size || 32;
  const box = el('div');
  box.style.cssText = 'display:flex;align-items:center;gap:' + Math.round(fs * 0.7) + 'px;height:100%';
  box.appendChild(planeIcon(Math.round(fs * 2.4), p.heading, ctx.style.color ? null : 'var(--gp-accent, #9fd3ff)'));
  const t = el('div');
  t.style.cssText = 'display:grid;gap:' + Math.round(fs * 0.12) + 'px;line-height:1.15;min-width:0';
  const r = route(p), who = [p.airline, p.flight || p.callsign].filter(Boolean).join(' ');
  t.appendChild(el('div', 'gp-flight-route', r || who));
  if (r && who) { const n = el('div', 'gp-flight-id', who); n.style.cssText = 'font-size:.72em;opacity:.9'; t.appendChild(n); }
  const facts = [aircraftName(p.aircraft), ft(p.alt), speedText(p.speed, o.units), dist(p.km, o.units) ? dist(p.km, o.units) + ' away' : ''].filter(Boolean).join('  ·  ');
  if (facts) { const n = el('div', '', facts); n.style.cssText = 'font-size:.6em;opacity:.78'; t.appendChild(n); }
  const more = data.planes.length - 1;
  if (more > 0) { const n = el('div', '', more + (more === 1 ? ' more plane nearby' : ' more planes nearby')); n.style.cssText = 'font-size:.52em;opacity:.6'; t.appendChild(n); }
  box.appendChild(t);
  return box;
}

/** A round radar scope: home in the middle, north up, each plane a small plane pointing where it is heading, the nearest labelled. */
function radar(ctx, data, o) {
  const S = Math.max(80, Math.min(ctx.w || 400, ctx.h || 400));
  const R = 46, s = svgEl('svg', { viewBox: '0 0 100 100', width: S, height: S, 'aria-hidden': 'true' });
  s.style.cssText = 'display:block;margin:auto;overflow:visible';
  const ink = 'currentColor';
  [1, 0.66, 0.33].forEach((f) => svgEl('circle', { cx: 50, cy: 50, r: R * f, fill: 'none', stroke: ink, 'stroke-width': 0.4, opacity: 0.35 }, s));
  svgEl('line', { x1: 50, y1: 50 - R, x2: 50, y2: 50 + R, stroke: ink, 'stroke-width': 0.3, opacity: 0.25 }, s);
  svgEl('line', { x1: 50 - R, y1: 50, x2: 50 + R, y2: 50, stroke: ink, 'stroke-width': 0.3, opacity: 0.25 }, s);
  const n = svgEl('text', { x: 50, y: 50 - R - 1.5, 'text-anchor': 'middle', 'font-size': 4, fill: ink, opacity: 0.6 }, s);
  n.textContent = 'N';
  svgEl('circle', { cx: 50, cy: 50, r: 1.2, fill: ink }, s);
  const maxKm = num(o.radius_km) || data.radius_km || Math.max(10, ...data.planes.map((p) => p.km || 0));
  // how far the outer ring is, so the scope has a scale
  const edge = svgEl('text', { x: (50 + R * 0.72).toFixed(2), y: (50 + R * 0.72 + 4).toFixed(2), 'font-size': 3.4, fill: ink, opacity: 0.55 }, s);
  edge.textContent = dist(maxKm, o.units).replace(/\.0 /, ' ');
  const placed = [{ x: 46, y: 50 - R - 6, w: 8, h: 6 }];  // label boxes already drawn (and the N), so close planes don't stack their labels
  let labelled = 0;
  data.planes.slice(0, 40).forEach((p, i) => {
    if (p.bearing === undefined || p.bearing === null || p.km === null || p.km === undefined) return;
    const d = Math.min(1, p.km / maxKm) * R, x = 50 + d * Math.sin(p.bearing * RAD), y = 50 - d * Math.cos(p.bearing * RAD);
    const g = svgEl('g', { transform: 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ') rotate(' + Math.round(p.heading || 0) + ') scale(.22) translate(-12 -12)' }, s);
    svgEl('path', { d: PLANE, fill: i === 0 ? 'var(--gp-accent, #9fd3ff)' : ink, opacity: i === 0 ? 1 : 0.75 }, g);
    if (labelled < (o.labels == null ? 3 : o.labels)) {
      const text = (p.flight || p.callsign) + (p.alt ? ' ' + ft(p.alt) : ''), w = text.length * 2.1, left = x > 70;
      const box = { x: left ? x - 3 - w : x + 3, y: y - 6, w, h: 4.6 };
      if (!placed.some((q) => box.x < q.x + q.w && q.x < box.x + box.w && box.y < q.y + q.h && q.y < box.y + box.h)) {
        placed.push(box);
        labelled++;
        const t = svgEl('text', { x: (left ? x - 3 : x + 3).toFixed(2), y: (y - 2).toFixed(2), 'font-size': 3.8, fill: ink, opacity: 0.9, 'text-anchor': left ? 'end' : 'start' }, s);
        t.textContent = text;
      }
    }
  });
  return s;
}

/** An airport-board list: flight, route, height, distance, nearest first. */
function board(ctx, data, o) {
  const t = el('div');
  const fs = ctx.style.size || 28, fit = ctx.h ? Math.max(1, Math.floor(ctx.h / (fs * 1.5))) : 99;   // as many rows as the box holds
  const rows = Math.max(1, Math.min(o.max_flights || 6, data.planes.length, fit));
  t.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto auto;column-gap:.8em;row-gap:.25em;align-items:baseline;font-variant-numeric:tabular-nums';
  data.planes.slice(0, rows).forEach((p) => {
    const cells = [p.flight || p.callsign, route(p) || (p.airline || ''), ft(p.alt), dist(p.km, o.units)];
    cells.forEach((c, i) => { const n = el('span', '', c || ''); if (i) n.style.opacity = i === 1 ? '.85' : '.65'; if (i === 1) n.style.cssText += ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0'; t.appendChild(n); });
  });
  return t;
}

export function flights(ctx) {
  const o = ctx.opts, ids = (Array.isArray(ctx.slots.entities) ? ctx.slots.entities : [ctx.slots.entities]).filter(Boolean);
  const render = async () => {
    const states = await Promise.all(ids.map((id) => ctx.data.state(id)));
    if (!ctx.root.isConnected) return;
    const data = planesFrom(states);
    clear(ctx.root);
    if (!ids.length || !data.planes.length) {
      const msg = !ids.length ? '' : (o.empty_text != null ? o.empty_text : 'No planes nearby right now');
      if (msg) ctx.root.appendChild(el('div', 'gp-dim', msg));
      return;
    }
    const look = o.look || 'overhead';
    ctx.root.appendChild(look === 'radar' ? radar(ctx, data, o) : look === 'board' ? board(ctx, data, o) : overhead(ctx, data, o));
  };
  ctx.refresh(render, ids, 0);
}

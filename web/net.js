// Room networking over Supabase Realtime: who is here, a shared clock, and joins.
// The server only relays messages. One device (the earliest to arrive) is the "time
// keeper": everyone syncs their clock to it, and it decides which orb pushes pair up.
import { addJoins, matchPushes } from './layout.js';

const SUPABASE_URL = 'https://aimoujzdcaxkejraattw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_D8DGNTiXWHRFaoE2ae3ACg_8G8Y_yDS'; // public by design

const WINDOW = 2000; // two pushes this close in time can pair (ms)
const wall = () => performance.timeOrigin + performance.now();

// `onSignal` (optional) receives messages sent with s.signal(to, data): a lane for
// pages that set up direct device-to-device connections. Only the addressee handles them.
export function joinRoom({ room, id, name, size, onSignal }) {
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const ch = client.channel('stitch:' + room, { config: { broadcast: { self: false }, presence: { key: id } } });
  const joinedAt = wall();
  const s = {
    id, name, room, status: 'connecting',
    peers: {},            // id -> { name, w, h, joinedAt }
    leader: null,
    offset: 0, rtt: null, samples: [],
    joins: [],
    listeners: new Set(),
    now: () => wall() + s.offset,   // shared clock (ms)
  };
  const emit = (ev, data) => s.listeners.forEach((f) => f(ev, data));
  const send = (event, payload) => ch.send({ type: 'broadcast', event, payload });

  function electLeader() {
    const all = Object.entries(s.peers).sort(([a, p], [b, q]) => (p.joinedAt - q.joinedAt) || (a < b ? -1 : 1));
    const prev = s.leader;
    s.leader = all.length ? all[0][0] : id;
    if (s.leader === id) { s.offset = 0; s.rtt = 0; }
    if (prev !== s.leader) { s.samples = []; emit('leader', s.leader); if (s.leader === id) sendLayout(); }
  }

  ch.on('presence', { event: 'sync' }, () => {
    const st = ch.presenceState();
    s.peers = {};
    for (const [key, metas] of Object.entries(st)) {
      const m = metas[metas.length - 1];
      s.peers[key] = { name: m.name, w: m.w, h: m.h, joinedAt: m.joinedAt };
    }
    electLeader();
    if (s.leader === id) sendLayout();
    emit('peers', s.peers);
  });

  // --- clock sync: NTP-style ping/pong with the time keeper ---
  ch.on('broadcast', { event: 'ping' }, ({ payload }) => {
    if (s.leader === id && payload.to === id) send('pong', { to: payload.from, t0: payload.t0, t1: s.now() });
  });
  ch.on('broadcast', { event: 'pong' }, ({ payload }) => {
    if (payload.to !== id) return;
    const t2 = wall(), rtt = t2 - payload.t0;
    s.samples.push({ rtt, off: payload.t1 - (payload.t0 + t2) / 2 });
    if (s.samples.length > 30) s.samples.shift();
    // trust the quickest round trips: the less time on the wire, the less room for error
    const best = [...s.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 5);
    const offs = best.map((x) => x.off).sort((a, b) => a - b);
    s.offset = offs[offs.length >> 1];
    s.rtt = best[0].rtt;
    emit('clock');
  });
  let pings = 0;
  const pingTimer = setInterval(() => {
    if (s.status !== 'live' || !s.leader || s.leader === id) return;
    if (pings++ > 20 && pings % 4) return; // fast at first, then every 2 s
    send('ping', { from: id, to: s.leader, t0: wall() });
  }, 500);

  // --- orb pushes and joins (decided by the time keeper) ---
  // The time keeper collects a burst of pushes and solves them together once nobody
  // has pushed for a moment.
  let pushes = [], burstTimer = null;
  function onPush(p) {
    if (s.leader !== id) return;
    pushes.push(p);
    clearTimeout(burstTimer);
    burstTimer = setTimeout(resolve, 900);
  }
  function resolve() {
    const batch = pushes; pushes = [];
    const sizes = Object.fromEntries(Object.entries(s.peers).map(([k, p]) => [k, { w: p.w, h: p.h }]));
    const { joins, retry, unmatched } = matchPushes(batch, WINDOW, { sizes, joins: s.joins });
    if (joins.length) {
      s.joins = addJoins(s.joins, joins, sizes);
      sendLayout();
      joins.forEach((j) => { send('joined', j); emit('joined', j); });
    }
    if (retry.length) { send('retry', { devs: retry }); emit('retry', { devs: retry }); }
    // a lone push keeps waiting until its 2 s window is over, in case the other kid is slow
    const cutoff = s.now() - WINDOW;
    for (const p of unmatched) {
      if (p.t > cutoff) pushes.push(p);
      else { send('nomatch', { dev: p.dev }); emit('nomatch', { dev: p.dev }); }
    }
    if (pushes.length) burstTimer = setTimeout(resolve, 400);
  }
  function sendLayout() {
    if (s.leader !== id) return;
    send('layout', { joins: s.joins });
    emit('layout');
  }
  ch.on('broadcast', { event: 'push' }, ({ payload }) => onPush(payload));
  ch.on('broadcast', { event: 'layout' }, ({ payload }) => { if (s.leader !== id) { s.joins = payload.joins; emit('layout'); } });
  for (const ev of ['joined', 'retry', 'nomatch']) ch.on('broadcast', { event: ev }, ({ payload }) => emit(ev, payload));

  s.push = (edge, along) => {
    const p = { dev: id, edge, along, t: s.now() };
    send('push', p);
    onPush(p);
  };
  s.resize = (w, h) => { if (s.status === 'live') ch.track({ name, w, h, joinedAt }); };
  if (onSignal) ch.on('broadcast', { event: 'sig' }, ({ payload }) => { if (payload.to === id) onSignal(payload.from, payload.data); });
  s.signal = (to, data) => send('sig', { from: id, to, data });
  s.on = (f) => s.listeners.add(f);
  s.leave = () => { clearInterval(pingTimer); client.removeChannel(ch); };

  ch.subscribe(async (st) => {
    if (st === 'SUBSCRIBED') {
      s.status = 'live';
      await ch.track({ name, w: size.w, h: size.h, joinedAt });
    } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') s.status = st.toLowerCase();
    emit('status', s.status);
  });
  return s;
}

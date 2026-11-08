/* アカウント・持ち物・決済（/api/...）。データは Cloudflare D1（env.DB、表は ../schema.sql）。
   - ゲストアカウント: 初めての端末に、見えない番号（id）と秘密の合言葉（token）を渡す。登録画面もメールもなし。
     サーバーには token そのものではなく SHA-256 だけを残す。
   - コインと持ち物はここが正本。ゲームは結果を報告するだけで、もらえる量・1日の上限・カプセルの抽選はここで決める。
   - お金は Stripe Checkout だけで受け取る。カード番号はこのサーバーにもゲームにも来ない。
     支払いが済んだかは Stripe からの通知（webhook、署名を確かめる）か、Stripe に直接問い合わせて確かめてから渡す。
   - 引き継ぎ: 24時間だけ使えるコードで、別の端末に同じアカウントを移す（元の端末の合言葉は使えなくなる）。
   - 配信者・キャンペーン用のコード: 表 codes に入れておくと、入力した人に全キャラなどを渡す。
   - 広告: 最後まで見た人にコイン（1日の回数と間隔に上限）。広告そのものはゲームのページが出す。 */
import { CHARS, CHAR_NAMES, STARTERS, LOOKS, SLOT_OF, COIN, SKUS } from './catalog.js';

const DAY = 86400000;
const jstDay = (t = Date.now()) => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
const enc = s => new TextEncoder().encode(s);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc(s)));
const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
/* codes people type: no 0/O/1/I/L */
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const typed = n => [...rand(n)].map(b => ABC[b % ABC.length]).join('');
const normCode = s => String(s || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
const isChar = c => CHARS.includes(c);
const isLook = l => Object.prototype.hasOwnProperty.call(LOOKS, l);

/* soft per-key limits (per isolate) */
const hits = new Map();
function limited(key, perMin) {
  const now = Date.now();
  if (hits.size > 10000) hits.clear();
  const h = hits.get(key);
  if (!h || now - h.at > 60000) { hits.set(key, { at: now, n: 1 }); return false; }
  return ++h.n > perMin;
}

const one = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).first();
const all = async (env, sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results || [];
const run = async (env, sql, ...a) => { const r = await env.DB.prepare(sql).bind(...a).run(); return (r && r.meta && r.meta.changes) || 0; };

async function auth(req, env) {
  const m = /^Bearer ([0-9a-f]{48})$/.exec(req.headers.get('Authorization') || '');
  return m ? one(env, 'SELECT * FROM players WHERE token = ?', await sha(m[1])) : null;
}
async function newToken(env, id) { const t = hex(rand(24)); await run(env, 'UPDATE players SET token = ? WHERE id = ?', await sha(t), id); return t; }

/* everything the game shows: coins, 仲間, looks, today's room, the ad rewards left, and the prices */
async function view(env, id) {
  const p = await one(env, 'SELECT * FROM players WHERE id = ?', id), rows = await all(env, 'SELECT kind, item FROM owned WHERE player = ?', id);
  const of = k => rows.filter(r => r.kind === k).map(r => r.item);
  let wear = {}; try { wear = JSON.parse(p.wear || '{}'); } catch (e) { wear = {}; }
  const today = jstDay();
  return {
    id: p.id, coins: p.coins, own: [...new Set([...STARTERS, ...of('ch')])], tried: of('tried'), items: of('look'), wear,
    room: Math.max(0, COIN.dayCap - (p.day === today ? p.day_earn : 0)), loginToday: p.login === today, tut: !!p.tut,
    adLeft: Math.max(0, COIN.adMax - (p.ad_day === today ? p.ad_n : 0)), now: Date.now(),
    price: { char: COIN.char, capsule: COIN.capsule, dayCap: COIN.dayCap },
    skus: Object.fromEntries(Object.entries(SKUS).map(([k, s]) => [k, { name: s.name, amount: s.amount }])),
    shop: !!(env.STRIPE_SECRET_KEY && env.GAME_URL),
  };
}
const ownsChar = async (env, id, c) => STARTERS.includes(c) || !!(await one(env, "SELECT 1 AS x FROM owned WHERE player = ? AND kind = 'ch' AND item = ?", id, c));
const give = (env, id, kind, item, src) => run(env, 'INSERT OR IGNORE INTO owned (player, kind, item, src, at) VALUES (?, ?, ?, ?, ?)', id, kind, item, src, Date.now());
const addCoins = (env, id, n) => run(env, 'UPDATE players SET coins = coins + ? WHERE id = ?', n, id);

/* ---------- Stripe ---------- */
async function stripe(env, method, path, form) {
  const body = form ? new URLSearchParams(form).toString() : undefined;
  const r = await fetch('https://api.stripe.com/v1' + path, {
    method, body,
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
  });
  const d = await r.json().catch(() => ({}));
  return r.ok ? d : { error: (d && d.error && d.error.message) || 'stripe ' + r.status };
}
/* Stripe-Signature: t=…,v1=…  — HMAC-SHA256 of "t.body" with the webhook secret, at most 5 minutes old */
async function signed(env, raw, header) {
  let t = 0; const v1 = [];
  for (const part of String(header || '').split(',')) { const [k, v] = part.split('='); if (k === 't') t = Number(v); else if (k === 'v1' && v) v1.push(v); }
  if (!t || !v1.length || !env.STRIPE_WEBHOOK_SECRET || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', enc(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, enc(t + '.' + raw)));
  return v1.some(s => s.length === mac.length && [...s].reduce((d, ch, i) => d | (ch.charCodeAt(0) ^ mac.charCodeAt(i)), 0) === 0);
}
/* hand over what was bought, once per Checkout Session whatever calls it (webhook or the game's check) */
async function grant(env, sess) {
  const md = sess.metadata || {};
  let row = await one(env, 'SELECT * FROM purchases WHERE session = ?', sess.id);
  if (!row) {
    if (!md.player || !SKUS[md.sku]) return false;
    await run(env, 'INSERT OR IGNORE INTO purchases (session, player, sku, arg, amount, status, created, done) VALUES (?, ?, ?, ?, ?, ?, ?, 0)', sess.id, md.player, md.sku, md.arg || '', sess.amount_total || 0, 'open', Date.now());
    row = await one(env, 'SELECT * FROM purchases WHERE session = ?', sess.id);
  }
  if (!(await run(env, "UPDATE purchases SET done = 1, status = 'paid' WHERE session = ? AND done = 0", sess.id))) return false;
  const id = row.player, s = SKUS[row.sku];
  if (row.sku === 'ch1') { if (!(await give(env, id, 'ch', row.arg, 'buy'))) await addCoins(env, id, COIN.char); }
  else if (row.sku === 'chall') { for (const c of CHARS) if (!STARTERS.includes(c)) await give(env, id, 'ch', c, 'buy'); }
  else if (row.sku.startsWith('look:')) await give(env, id, 'look', row.sku.slice(5), 'buy');
  if (s && s.looks) for (const l of s.looks) await give(env, id, 'look', l, 'buy');
  return true;
}
async function webhook(req, env) {
  const raw = await req.text();
  if (!(await signed(env, raw, req.headers.get('Stripe-Signature')))) return new Response('bad signature', { status: 400 });
  let ev = {}; try { ev = JSON.parse(raw); } catch (e) { return new Response('bad json', { status: 400 }); }
  const o = ev.data && ev.data.object;
  if ((ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') && o && o.payment_status === 'paid') await grant(env, o);
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function handleApi(req, env, cors, path) {
  const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
  if (path === '/api/stripe/webhook' && req.method === 'POST') return env.DB ? webhook(req, env) : new Response('no db', { status: 503 });
  if (!cors['Access-Control-Allow-Origin']) return J({ error: 'origin' }, 403);
  if (!env.DB) return J({ error: 'no_db' }, 503);
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  if (limited('ip:' + ip, Number(env.API_PER_MIN) || 120)) return J({ error: 'rate' }, 429);
  const raw = req.method === 'POST' ? await req.text() : '';
  if (raw.length > 4000) return J({ error: 'size' }, 413);
  let inp = {}; try { inp = raw ? JSON.parse(raw) : {}; } catch (e) { return J({ error: 'json' }, 400); }
  if (!inp || typeof inp !== 'object') inp = {};
  const now = Date.now(), today = jstDay(now);

  /* no account yet: make one */
  if (path === '/api/guest' && req.method === 'POST') {
    if (limited('guest:' + ip, 10)) return J({ error: 'rate' }, 429);
    const id = 'p_' + hex(rand(8)), t = hex(rand(24));
    await run(env, 'INSERT INTO players (id, token, created) VALUES (?, ?, ?)', id, await sha(t), now);
    return J({ token: t, me: await view(env, id) });
  }
  /* 引き継ぎ (on the new device): the code moves the account here and the old device's token stops working */
  if (path === '/api/transfer/use' && req.method === 'POST') {
    if (limited('xfer:' + ip, 10)) return J({ error: 'rate' }, 429);
    const c = normCode(inp.code), row = c && await one(env, 'SELECT * FROM transfers WHERE code = ?', c);
    if (!row || row.expires < now) return J({ error: 'code' }, 404);
    /* one use: only the request that removes the code gets the account (two at once would both make a token) */
    if (!(await run(env, 'DELETE FROM transfers WHERE code = ?', c))) return J({ error: 'code' }, 404);
    return J({ token: await newToken(env, row.player), me: await view(env, row.player) });
  }

  const p = await auth(req, env);
  if (!p) return J({ error: 'auth' }, 401);
  const id = p.id;
  if (limited('p:' + id, Number(env.PLAYER_PER_MIN) || 60)) return J({ error: 'rate' }, 429);

  switch (path) {
    case '/api/me': return J({ me: await view(env, id) });

    /* ログインボーナス: once a day (Japan time), more the very first time */
    case '/api/login': {
      const n = p.login ? COIN.loginDaily : COIN.loginFirst;
      const got = (await run(env, 'UPDATE players SET coins = coins + ?, login = ? WHERE id = ? AND login != ?', n, today, id, today)) ? n : 0;
      return J({ got, first: got === COIN.loginFirst, me: await view(env, id) });
    }
    case '/api/tutorial': {
      const got = (await run(env, 'UPDATE players SET coins = coins + ?, tut = 1 WHERE id = ? AND tut = 0', COIN.tutorial, id)) ? COIN.tutorial : 0;
      return J({ got, me: await view(env, id) });
    }
    /* progress from the version that kept everything on the device: once, within 10 minutes of making the account, with caps */
    case '/api/import': {
      if (now - p.created > 600000) return J({ error: 'late' }, 409);
      /* once: of two at once, the second finds imported already set */
      if (!(await run(env, 'UPDATE players SET imported = 1, coins = coins + ? WHERE id = ? AND imported = 0', Math.max(0, Math.min(2000, Math.floor(+inp.coins || 0))), id))) return J({ error: 'late' }, 409);
      const arr = a => (Array.isArray(a) ? a.slice(0, 40) : []);
      for (const c of arr(inp.own).filter(c => isChar(c) && !STARTERS.includes(c)).slice(0, 3)) await give(env, id, 'ch', c, 'import');
      for (const c of arr(inp.tried).filter(isChar)) await give(env, id, 'tried', c, 'import');
      for (const l of arr(inp.items).filter(l => isLook(l) && LOOKS[l] < 3)) await give(env, id, 'look', l, 'import');
      return J({ me: await view(env, id) });
    }
    /* coins for a fight: the game says how it went, this decides how much (and keeps to today's cap) */
    case '/api/earn': {
      const res = ['win', 'draw', 'lose'].includes(inp.res) ? inp.res : 'lose', n = Math.max(2, Math.min(4, Math.floor(+inp.n || 2)));
      const want = inp.mode === 'online' ? COIN.online[res] : Math.round(COIN.cpu[res] * (COIN.lvMul[Math.max(0, Math.min(2, Math.floor(+inp.lv || 0)))]) * (1 + 0.25 * (n - 2)));
      if (now - p.last_earn < COIN.gapMs) return J({ got: 0, early: true, want, me: await view(env, id) });
      const used = p.day === today ? p.day_earn : 0, got = Math.max(0, Math.min(want, COIN.dayCap - used));
      const ok = await run(env, 'UPDATE players SET coins = coins + ?, day = ?, day_earn = ?, last_earn = ? WHERE id = ? AND last_earn = ?', got, today, used + got, now, id, p.last_earn);
      return J({ got: ok ? got : 0, want, me: await view(env, id) });
    }
    case '/api/unlock': {
      const c = inp.ch;
      if (!isChar(c) || await ownsChar(env, id, c)) return J({ error: 'owned' }, 400);
      if (!(await run(env, 'UPDATE players SET coins = coins - ? WHERE id = ? AND coins >= ?', COIN.char, id, COIN.char))) return J({ error: 'coins' }, 400);
      if (!(await give(env, id, 'ch', c, 'coins'))) await addCoins(env, id, COIN.char);
      return J({ ok: true, me: await view(env, id) });
    }
    /* お試し: one CPU fight with a 潜水者 that is not yours yet */
    case '/api/try': {
      const c = inp.ch;
      if (!isChar(c) || await ownsChar(env, id, c)) return J({ ok: false, me: await view(env, id) });
      return J({ ok: !!(await give(env, id, 'tried', c, 'try')), me: await view(env, id) });
    }
    /* カプセル: the draw happens here; n = 1 or 5 at once (each one costs the same) */
    case '/api/pull': {
      const n = inp.n === 5 ? 5 : 1, cost = COIN.capsule * n;
      if (!(await run(env, 'UPDATE players SET coins = coins - ? WHERE id = ? AND coins >= ?', cost, id, cost))) return J({ error: 'coins' }, 400);
      const results = [];
      for (let k = 0; k < n; k++) {
        let r = 0, x = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
        for (let i = 0; i < COIN.odds.length; i++) { r = i; if (x < COIN.odds[i]) break; x -= COIN.odds[i]; }
        const pool = Object.keys(LOOKS).filter(l => LOOKS[l] === r), item = pool[crypto.getRandomValues(new Uint32Array(1))[0] % pool.length];
        const dup = !(await give(env, id, 'look', item, 'capsule'));
        if (dup) await addCoins(env, id, COIN.back[r]);
        results.push({ item, r, dup, back: dup ? COIN.back[r] : 0 });
      }
      return J({ results, ...results[0], me: await view(env, id) });
    }
    /* 広告を最後まで見た: coins, a few times a day */
    case '/api/adreward': {
      const used = p.ad_day === today ? p.ad_n : 0;
      if (used >= COIN.adMax || now - p.last_ad < COIN.adGapMs) return J({ got: 0, me: await view(env, id) });
      const ok = await run(env, 'UPDATE players SET coins = coins + ?, ad_day = ?, ad_n = ?, last_ad = ? WHERE id = ? AND last_ad = ?', COIN.ad, today, used + 1, now, id, p.last_ad);
      return J({ got: ok ? COIN.ad : 0, me: await view(env, id) });
    }
    /* what each 潜水者 wears: only things you have */
    case '/api/wear': {
      const c = inp.ch; if (!isChar(c)) return J({ error: 'bad' }, 400);
      const mine = new Set((await all(env, "SELECT item FROM owned WHERE player = ? AND kind = 'look'", id)).map(r => r.item));
      let wear = {}; try { wear = JSON.parse(p.wear || '{}'); } catch (e) { wear = {}; }
      const L = { col: '', head: '', pet: '', wear: '' }, w = inp.look && typeof inp.look === 'object' ? inp.look : {};
      for (const sl of Object.keys(L)) if (mine.has(w[sl]) && SLOT_OF(w[sl]) === sl) L[sl] = w[sl];
      wear[c] = L;
      await run(env, 'UPDATE players SET wear = ? WHERE id = ?', JSON.stringify(wear), id);
      return J({ me: await view(env, id) });
    }
    /* buying: a Stripe Checkout page for one thing; what was bought is handed over after Stripe says it is paid */
    case '/api/checkout': {
      if (!env.STRIPE_SECRET_KEY || !env.GAME_URL) return J({ error: 'closed' }, 503);
      const sku = String(inp.sku || ''), s = SKUS[sku]; if (!s) return J({ error: 'sku' }, 400);
      let arg = '';
      if (s.needsChar) { arg = String(inp.arg || ''); if (!isChar(arg) || await ownsChar(env, id, arg)) return J({ error: 'owned' }, 400); }
      const me = await view(env, id);
      if (sku === 'chall' && CHARS.every(c => me.own.includes(c))) return J({ error: 'owned' }, 400);
      const looks = sku.startsWith('look:') ? [sku.slice(5)] : s.looks && sku !== 'support' ? s.looks : [];
      if (looks.length && looks.every(l => me.items.includes(l))) return J({ error: 'owned' }, 400);
      const back = String(env.GAME_URL), sep = back.includes('?') ? '&' : '?';
      const sess = await stripe(env, 'POST', '/checkout/sessions', {
        mode: 'payment', locale: 'ja', client_reference_id: id,
        'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'jpy', 'line_items[0][price_data][unit_amount]': String(s.amount),
        'line_items[0][price_data][product_data][name]': s.name + (arg ? '（' + (CHAR_NAMES[arg] || arg) + '）' : ''),
        success_url: back + sep + 'paid={CHECKOUT_SESSION_ID}', cancel_url: back + sep + 'paid=cancel',
        'metadata[player]': id, 'metadata[sku]': sku, 'metadata[arg]': arg,
      });
      if (sess.error || !sess.url) return J({ error: 'stripe', detail: String(sess.error || '').slice(0, 120) }, 502);
      await run(env, 'INSERT OR IGNORE INTO purchases (session, player, sku, arg, amount, status, created, done) VALUES (?, ?, ?, ?, ?, ?, ?, 0)', sess.id, id, sku, arg, s.amount, 'open', now);
      return J({ url: sess.url });
    }
    /* back from the payment page: ask Stripe directly (in case its notice has not come yet) */
    case '/api/checkout/confirm': {
      const sid = String(inp.session || ''); if (!/^cs_[A-Za-z0-9_]{6,200}$/.test(sid)) return J({ error: 'bad' }, 400);
      const row = await one(env, 'SELECT * FROM purchases WHERE session = ? AND player = ?', sid, id);
      if (!row) return J({ error: 'unknown' }, 404);
      if (row.done) return J({ granted: true, sku: row.sku, me: await view(env, id) });
      const sess = await stripe(env, 'GET', '/checkout/sessions/' + encodeURIComponent(sid));
      if (sess.error) return J({ error: 'stripe' }, 502);
      if (sess.payment_status === 'paid' && (sess.metadata || {}).player === id) { await grant(env, sess); return J({ granted: true, sku: row.sku, me: await view(env, id) }); }
      return J({ granted: false, status: String(sess.payment_status || sess.status || ''), me: await view(env, id) });
    }
    /* 引き継ぎ (on the old device): a code for 24 hours */
    case '/api/transfer/new': {
      await run(env, 'DELETE FROM transfers WHERE player = ? OR expires < ?', id, now);
      const c = typed(10), exp = now + DAY;
      await run(env, 'INSERT INTO transfers (code, player, expires) VALUES (?, ?, ?)', c, id, exp);
      return J({ code: c.slice(0, 5) + '-' + c.slice(5), expires: exp });
    }
    /* 配信者・キャンペーンのコード: kind is all (every 潜水者), coins:N or look:<id> */
    case '/api/redeem': {
      const c = normCode(inp.code), row = c && await one(env, 'SELECT * FROM codes WHERE code = ?', c);
      if (!row || (row.expires && row.expires < now) || row.uses >= row.max_uses) return J({ error: 'code' }, 404);
      /* claim it for this player first, so two taps at once count (and give) once */
      if (!(await run(env, 'INSERT OR IGNORE INTO redeemed (code, player, at) VALUES (?, ?, ?)', c, id, now))) return J({ error: 'used' }, 409);
      if (!(await run(env, 'UPDATE codes SET uses = uses + 1 WHERE code = ? AND uses < max_uses', c))) { await run(env, 'DELETE FROM redeemed WHERE code = ? AND player = ?', c, id); return J({ error: 'code' }, 404); }
      const [k, v] = String(row.kind).split(':');
      if (k === 'all') { for (const ch of CHARS) if (!STARTERS.includes(ch)) await give(env, id, 'ch', ch, 'code'); }
      else if (k === 'coins') await addCoins(env, id, Math.max(0, Math.min(10000, Math.floor(+v || 0))));
      else if (k === 'look' && isLook(v)) await give(env, id, 'look', v, 'code');
      return J({ kind: row.kind, note: row.note, me: await view(env, id) });
    }
  }
  return J({ error: 'path' }, 404);
}

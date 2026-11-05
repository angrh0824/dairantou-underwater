-- 大乱闘アンダーウォーター のアカウントと持ち物（Cloudflare D1）
-- 作り方: このフォルダで  npx wrangler d1 execute dairantou --remote --file=schema.sql

-- 一人ひとり（ゲストアカウント）。token は合言葉そのものではなく SHA-256
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  coins INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL DEFAULT '',          -- day_earn を数えている日（日本時間）
  day_earn INTEGER NOT NULL DEFAULT 0,   -- その日に対戦でかせいだコイン
  login TEXT NOT NULL DEFAULT '',        -- ログインボーナスを最後に受け取った日
  tut INTEGER NOT NULL DEFAULT 0,        -- チュートリアルのボーナスを受け取った
  imported INTEGER NOT NULL DEFAULT 0,   -- 端末だけの試作版から引き継いだ
  last_earn INTEGER NOT NULL DEFAULT 0,  -- 最後に対戦のコインを受け取った時刻（ミリ秒）
  ai_until INTEGER NOT NULL DEFAULT 0,   -- AIパスの期限（ミリ秒）
  wear TEXT NOT NULL DEFAULT '{}'        -- 潜水者ごとの着せ替え
);

-- 持っているもの: kind = ch（仲間）/ look（着せ替え）/ tried（お試し済み）
CREATE TABLE IF NOT EXISTS owned (
  player TEXT NOT NULL,
  kind TEXT NOT NULL,
  item TEXT NOT NULL,
  src TEXT NOT NULL DEFAULT '',          -- coins / capsule / buy / code / import / try
  at INTEGER NOT NULL,
  PRIMARY KEY (player, kind, item)
);

-- Stripe Checkout の購入。done = 1 になったら渡し済み（二重に渡さない）
CREATE TABLE IF NOT EXISTS purchases (
  session TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  sku TEXT NOT NULL,
  arg TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  created INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS purchases_player ON purchases (player);

-- 引き継ぎコード（24時間）
CREATE TABLE IF NOT EXISTS transfers (
  code TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  expires INTEGER NOT NULL
);

-- 配信者・キャンペーン用のコード。kind = all / coins:500 / look:h-crown / ai:7
-- 例: INSERT INTO codes (code, kind, note, max_uses, expires) VALUES ('STREAMER2026', 'all', '配信者さん用', 50, 0);
--     （code は英大文字と数字だけ。expires は期限のミリ秒、0 なら期限なし）
CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  uses INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 1,
  expires INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS redeemed (
  code TEXT NOT NULL,
  player TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (code, player)
);

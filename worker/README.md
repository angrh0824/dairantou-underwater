# 大乱闘アンダーウォーター のサーバー（Cloudflare Worker）

ひとつのサーバーで、次のものを受け持ちます。

- **アカウントと持ち物**：見えないゲストアカウント、コイン、仲間、着せ替え、カプセルの抽選、1日の上限
- **お金の受け取り**：Stripe Checkout（カード番号はこのサーバーにもゲームにも来ません）
- **引き継ぎと配信者コード**
- **広告のコイン**：広告を最後まで見た人へのコイン（1日3回まで）
- **声のAI**：Jev とぼやきの中継（`index.html` の `VOICE_AI` にサーバーのアドレスを入れたときだけ使われます。呼ぶたびに OpenRouter の料金がかかります）

サーバーを用意するまでは、ゲーム（`index.html` の `const SERVER = '';`）は端末の中だけで動きます。ショップは出ません。

---

## 用意するもの（あなたの作業）

| もの | 使いみち | メモ |
|---|---|---|
| Cloudflare アカウント | サーバーとデータベース | 無料で作れます |
| Stripe アカウント | お金の受け取り | まずテストモードで試せます。本番は本人確認と口座の登録が必要です |
| OpenRouter のキー | 声のAI（使うときだけ） | 上限額をつけた専用のキーをおすすめします |
| Google AdSense アカウント | 広告 | 審査があります（下の「広告」） |

アカウントの作成と、キーの入力（`secret put`）はご自身で行ってください。キーはファイルに書かず、チャットにも貼らないでください。

---

## 1. サーバーを動かす

このフォルダ（`worker`）で、順に実行します。

```bash
npx wrangler login
```

ブラウザが開くので、Cloudflare にログインして許可します。

```bash
npx wrangler d1 create dairantou
```

表示された `database_id` を、`wrangler.toml` の `database_id = "…"` に貼ります。

```bash
npx wrangler d1 execute dairantou --remote --file=schema.sql
```

データベースの表を作ります。

```bash
npx wrangler secret put OPENROUTER_API_KEY
```

OpenRouter のキーを貼ります（画面には出ません）。声のAIを使わないなら、この手順は飛ばしてかまいません。

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

Stripe のダッシュボード →「開発者」→「APIキー」の **シークレットキー**。最初はテスト用（`sk_test_` で始まるもの）を貼ります。

```bash
npx wrangler deploy
```

最後に `https://dairantou-voice.＜あなたの名前＞.workers.dev` のようなアドレスが出ます。これがサーバーのアドレスです。

## 2. Stripe に「支払いが済んだ」通知を送ってもらう

1. Stripe のダッシュボード →「開発者」→「Webhook」→「エンドポイントを追加」
2. URL：`https://＜サーバーのアドレス＞/api/stripe/webhook`
3. イベント：`checkout.session.completed` と `checkout.session.async_payment_succeeded`
4. 作ったら「署名シークレット」（`whsec_` で始まる）をコピーして、次を実行して貼ります

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

通知が来なくても、ゲームに戻ったときにサーバーが Stripe に直接確かめるので、品目は届きます。通知は、支払い後にページを閉じてしまった人のための保険です。

## 3. ゲームをサーバーにつなぐ

`index.html` の次の行に、サーバーのアドレスを入れて push します。

```js
const SERVER = 'https://dairantou-voice.＜あなたの名前＞.workers.dev';
```

これでゲストアカウント、サーバーでのコイン管理、ショップ、引き継ぎ、コード入力、広告のコインのサーバー管理が有効になります。端末の中だけで遊んでいた記録は、最初の1回だけサーバーに引き継がれます（コインは2000まで、仲間は3体まで）。Claude のアーティファクト版は、決済画面に移れないので、これまでどおり端末の中だけで動きます。

## 4. テストモードで買ってみる

- カード番号 `4242 4242 4242 4242`、有効期限は未来の日付、セキュリティコードは何でもかまいません
- テストモードではお金は動きません。Stripe のダッシュボードの「支払い」に記録が出ます

## 5. 本番にする前に

1. `tokushoho.html`・`terms.html`・`privacy.html` の【要記入】をすべて埋める。特定商取引法の表記は、お金を受け取る前に必ず必要です。個人で住所や電話番号の掲載に不安がある場合は、消費者庁の案内を確認するか専門家に相談してください（下書きは法律の助言ではありません）
2. Stripe を本番モードにする（本人確認・口座の登録）
3. 本番のシークレットキー（`sk_live_`）を `STRIPE_SECRET_KEY` に入れ直す
4. 本番モードで Webhook を作り直し、その署名シークレットを `STRIPE_WEBHOOK_SECRET` に入れ直す
5. 自分で1回買ってみて、届くことと、Stripe に記録が出ることを確かめる

---

## 広告（Google AdSense の H5 Games Ads）

ゲームの中の広告は、サーバーとは別に、ゲームのページ（`index.html`）が出します。

1. Google AdSense のアカウントを作り、サイトを登録して審査を受けます
2. Webゲーム用の広告（H5 Games Ads）の利用を申し込みます
3. `index.html` の `const ADS_CLIENT = '';` に、AdSense の「ca-pub-」で始まる番号を入れます
4. 審査の前に動きを見たいときは、`const ADS_TEST = true;` にすると Google のテスト広告が出ます（公開前に false に戻す）
5. AdSense の案内にしたがって、サイトのいちばん上に `ads.txt` を置きます

出る場所:
- 試合の前（その日2回目の試合から、2分に1回まで。オンライン対戦とチュートリアルの前には出しません）
- コレクションの「広告を見て +50コイン」（見たい人だけ。1日3回まで）

注意: AdSense は、自分で持っているドメインのサイトでないと審査に通りにくいです。`angrh0824.github.io/dairantou-underwater/` のままだと、`ads.txt` をドメインのいちばん上に置けません。独自ドメイン（年に千〜数千円ほど）を取って GitHub Pages につなぐことをおすすめします。

## 値段と品目を変える

`src/catalog.js` を書き換えて `npx wrangler deploy` します。

- `SKUS`：お金で買うもの（円）
- `COIN`：コインの値段、1日の上限、ボーナス、カプセルの確率

ゲームの表示する値段はサーバーから受け取ります。キャラや着せ替えの種類を増やすときは、`index.html` の `ROSTER`・`LOOKS` も同じ id で増やしてください。

## 配信者・キャンペーン用のコードを作る

```bash
npx wrangler d1 execute dairantou --remote --command "INSERT INTO codes (code, kind, note, max_uses, expires) VALUES ('STREAMER2026', 'all', '配信者さん用', 50, 0)"
```

- `code`：英大文字と数字だけ（入力は小文字やハイフンが混ざってもかまいません）
- `kind`：`all`（全キャラ）／ `coins:500`（コイン）／ `look:h-crown`（着せ替え）
- `max_uses`：使える人数、`expires`：期限（ミリ秒。0 なら期限なし）

## 安全のためにしていること

- ゲームのページ（`ALLOWED_ORIGINS`）以外からのアクセスは受け付けません（Stripe の通知だけは署名で確かめます）
- 合言葉はサーバーに元に戻せない形でしか残しません
- コイン・抽選・1日の上限・購入の受け渡しはすべてサーバーで決めます。ゲーム側を書き換えても、上限より多くはかせげません
- 同じ支払いで品目を二重に渡しません（Stripe の通知とゲームの確認のどちらが先でも1回だけ）
- 引き継ぎコード・配信者コード・端末の記録の取り込みは、同時に2回届いても1回分しか効きません
- 呼び出しの回数に上限があります（`API_PER_MIN`・`PLAYER_PER_MIN` で変更）

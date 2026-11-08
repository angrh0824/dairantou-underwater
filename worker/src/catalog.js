/* 品目と値段: サーバー側の正本。ゲーム（index.html）の ROSTER / LOOKS / STARTERS / PRICE と同じ id を使う。
   値段（円）はここを書き換えれば変わる。ゲームの表示もこのサーバーから受け取る。 */

export const CHARS = [
  'whale-man', 'star-person', 'mantis-count', 'jelly-principal', 'shark-lost', 'ink-pianist', 'seahorse-manager',
  'puffer-gatekeeper', 'manta-house', 'slug-fossil', 'octopus-snail', 'crab-meeting', 'angler-note', 'otter-robot',
  'garden-tower', 'coelacanth-dream', 'turtle-printer', 'shrimp-cadet', 'clione-guard', 'sea-cucumber-ceo',
];
/* 名前（Stripe の支払い画面と領収書に出る） */
export const CHAR_NAMES = {
  'whale-man': 'クジラおとこ', 'star-person': 'ヒトデ・ノ・ヒトデ', 'mantis-count': 'シャコパンチ伯爵', 'jelly-principal': 'クラゲ校長', 'shark-lost': 'サメの忘れ物',
  'ink-pianist': 'イカ墨ピアニスト', 'seahorse-manager': 'タツノオトシゴ課長', 'puffer-gatekeeper': 'フグの門番', 'manta-house': 'マンタが住む家', 'slug-fossil': 'ウミウシの化石',
  'octopus-snail': 'タコ足のかたつむり', 'crab-meeting': 'カニの反省会', 'angler-note': 'アンコウの置き手紙', 'otter-robot': 'ラッコ風ロボ', 'garden-tower': 'チンアナゴ・タワー',
  'coelacanth-dream': 'シーラカンスの夢', 'turtle-printer': 'カメのプリンター', 'shrimp-cadet': 'エビフライ候補生', 'clione-guard': 'クリオネ警備員', 'sea-cucumber-ceo': 'ナマコの社長',
};
/* 最初から仲間 */
export const STARTERS = ['whale-man', 'shark-lost', 'jelly-principal', 'puffer-gatekeeper', 'octopus-snail', 'shrimp-cadet'];

/* 着せ替え: r 0 ふつう / 1 レア / 2 激レア はカプセルから。3 はショップだけで売る */
export const LOOKS = {
  'c-sakura': 0, 'c-wakaba': 0, 'c-yozora': 0, 'c-yuyake': 0, 'c-yuki': 1, 'c-sumi': 1, 'c-kogane': 1, 'c-niji': 2,
  'h-flower': 0, 'h-cloud': 0, 'h-bubble': 0, 'h-heart': 0, 'h-star': 1, 'h-halo': 1, 'h-crown': 2,
  'p-fish': 0, 'p-bubbles': 0, 'p-plankton': 0, 'p-jelly': 1, 'p-star': 1, 'p-shark': 2,
  /* ふく: 体に合わせて着るもの。着られる潜水者はゲーム側の NECK で決まる */
  'w-muffler': 1, 'w-bowtie': 0, 'w-bell': 0, 'w-bandana': 0, 'w-lei': 1, 'w-pendant': 1, 'w-fur': 2,
  /* かお: 目に合わせてかけるもの */
  'f-round': 0, 'f-mono': 0, 'f-sun': 1, 'f-heart': 1, 'f-groucho': 2,
  'c-neon': 3, 'h-ribbon': 3, 'h-witch': 3, 'p-whale': 3, 'p-ufo': 3, 'h-medal': 3,
};
export const SLOT_OF = id => ({ c: 'col', h: 'head', p: 'pet', w: 'wear', f: 'face' })[String(id)[0]] || '';

/* コイン（遊んでためる。お金では買えない） */
export const COIN = {
  char: 1200, capsule: 100, dayCap: 600, loginFirst: 300, loginDaily: 100, tutorial: 200,
  /* 対戦1回: CPU戦は勝ち・引き分け・負け × 強さ（よわい・ふつう・つよい）× 人数。オンラインは別 */
  cpu: { win: 60, draw: 30, lose: 20 }, lvMul: [0.5, 1, 1.6], online: { win: 80, draw: 40, lose: 30 },
  back: [30, 60, 100], odds: [0.7, 0.25, 0.05],
  /* 次の対戦の報酬まで最低これだけ空ける（ミリ秒）: 結果の連打を防ぐ。登場とカウントダウンだけで約4秒かかるので、すぐ場外で決まった試合でも届く長さ */
  gapMs: 8000,
  /* 広告を最後まで見たら: 1回 ad コイン、1日 adMax 回まで、次まで adGapMs あける */
  ad: 50, adMax: 3, adGapMs: 30000,
};

/* お金で買うもの（Stripe）。amount は円（税込）。grant はサーバーが購入後に渡すもの */
export const SKUS = {
  ch1: { name: 'キャラ1体をすぐ仲間に', amount: 160, needsChar: true },
  chall: { name: 'まだ仲間でない全キャラ', amount: 980 },
  'look:c-neon': { name: '着せ替え「ネオン」（カラー）', amount: 200 },
  'look:h-ribbon': { name: '着せ替え「おおきなリボン」（あたま）', amount: 200 },
  'look:h-witch': { name: '着せ替え「まじょのぼうし」（あたま）', amount: 200 },
  'look:p-whale': { name: '着せ替え「ちびクジラ」（おとも）', amount: 250 },
  'look:p-ufo': { name: '着せ替え「ちびUFO」（おとも）', amount: 250 },
  premium: { name: 'ショップ着せ替え5つセット', amount: 800, looks: ['c-neon', 'h-ribbon', 'h-witch', 'p-whale', 'p-ufo'] },
  support: { name: '応援パック（おうえんメダルつき）', amount: 500, looks: ['h-medal'] },
};

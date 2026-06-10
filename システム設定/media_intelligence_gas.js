// ============================================================
// メディア業界 情報収集ツール for SmartNews
// 投稿先: #jp-mb-media_partnership
// 実行: 毎朝9時（時間トリガーで設定）
// ============================================================

// ── 設定 ────────────────────────────────────────────────────
const CONFIG = {
  SLACK_BOT_TOKEN: 'YOUR_SLACK_BOT_TOKEN', // xoxb-... をここに設定
  SLACK_CHANNEL_ID: 'C02QQGGLS',            // #jp-mb-media_partnership
  GOOGLE_SEARCH_API_KEY: 'YOUR_GOOGLE_SEARCH_API_KEY', // Google Custom Search API Key
  GOOGLE_SEARCH_ENGINE_ID: 'YOUR_SEARCH_ENGINE_ID',   // Google Custom Search Engine ID

  // 収集するRSSフィード（メディア業界専門ソースに絞る）
  RSS_FEEDS: [
    { url: 'https://media-innovation.jp/rss20/index.rdf', label: 'メディア業界' },
    { url: 'https://www.pressnet.or.jp/feed/headline.xml', label: '日本新聞協会' },
  ],

  // Google Newsで検索するキーワード（人事情報専用）
  PERSONNEL_SEARCH_KEYWORDS: [
    '出版社 編集長 就任',
    '新聞社 役員 就任',
    'メディア 社長 就任',
    '出版 人事異動',
    '編集長 交代',
  ],

  // Google Newsで検索するキーワード（業界ニュース専用）
  SEARCH_KEYWORDS: [
    'メディア 買収 提携',
    'ニュースメディア 新サービス',
    '出版社 デジタル',
    'メディア業界 動向',
  ],

  // 人事関連のキーワード（媒体社の人事に絞る）
  PERSONNEL_KEYWORDS: ['就任', '退任', '退職', '退社', '異動', '交代', '編集長', '社長', '役員', '代表取締役', '人事'],

  // メディア・関連業界のキーワード（人事情報の絞り込み用）
  MEDIA_INDUSTRY_KEYWORDS: ['新聞', '出版', '雑誌', '放送', 'テレビ', 'ラジオ', 'メディア', '編集', '記者', '報道', 'デジタルメディア', 'ニュース', '通信社', '広告', 'PR'],

  MAX_ARTICLES_PER_CATEGORY: 5, // カテゴリごとの最大記事数
};

// ── メインエントリーポイント ─────────────────────────────────
function runDailyMediaIntelligence() {
  try {
    Logger.log('情報収集開始...');

    const allArticles = [];

    // 1. RSS収集
    const rssArticles = collectFromRSS();
    allArticles.push(...rssArticles);
    Logger.log(`RSS収集: ${rssArticles.length}件`);

    // 2. Google News検索（無効化中）
    // const newsArticles = collectFromGoogleNews();
    // allArticles.push(...newsArticles);

    if (allArticles.length === 0) {
      Logger.log('収集した記事がありません');
      return;
    }

    // 3. カテゴリ別に分類してSlack投稿
    const digest = generateDigest(allArticles);
    postToSlack(digest);

    Logger.log('完了');
  } catch (e) {
    Logger.log('エラー: ' + e.message);
    notifyError(e.message);
  }
}

// ── RSS収集 ──────────────────────────────────────────────────
function collectFromRSS() {
  const articles = [];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  for (const feed of CONFIG.RSS_FEEDS) {
    try {
      const response = UrlFetchApp.fetch(feed.url, { muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) continue;

      const xml = XmlService.parse(response.getContentText());
      const root = xml.getRootElement();

      // RSS 2.0 と Atom 両対応
      let items = root.getChildren('channel').length > 0
        ? root.getChild('channel').getChildren('item')
        : root.getChildren('entry', XmlService.getNamespace('http://www.w3.org/2005/Atom'));

      for (const item of items) {
        const title = getXmlText(item, 'title');
        const link = getXmlText(item, 'link') || getXmlAttr(item, 'link', 'href');
        const pubDate = getXmlText(item, 'pubDate') || getXmlText(item, 'published');
        const description = getXmlText(item, 'description') || getXmlText(item, 'summary');

        if (!title || !link) continue;

        // 過去7日以内の記事のみ
        if (pubDate) {
          const articleDate = new Date(pubDate);
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          if (articleDate < weekAgo) continue;
        }

        const hasPersonnelKw = CONFIG.PERSONNEL_KEYWORDS.some(kw => title.includes(kw) || (description && description.includes(kw)));
        const hasMediaKw = CONFIG.MEDIA_INDUSTRY_KEYWORDS.some(kw => title.includes(kw) || (description && description.includes(kw)));
        const isPersonnel = hasPersonnelKw && hasMediaKw;

        articles.push({
          title: title.trim(),
          url: link.trim(),
          source: feed.label,
          description: description ? description.replace(/<[^>]*>/g, '').substring(0, 200) : '',
          isPersonnel,
          publishedAt: pubDate || '',
        });
      }
    } catch (e) {
      Logger.log(`RSS取得エラー [${feed.url}]: ${e.message}`);
    }
  }

  return articles;
}

function getXmlText(element, tagName) {
  try {
    const child = element.getChild(tagName);
    return child ? child.getText() : null;
  } catch (e) {
    return null;
  }
}

function getXmlAttr(element, tagName, attrName) {
  try {
    const child = element.getChild(tagName);
    return child ? child.getAttribute(attrName).getValue() : null;
  } catch (e) {
    return null;
  }
}

// ── Google News検索 ──────────────────────────────────────────
function collectFromGoogleNews() {
  const articles = [];

  // 人事情報キーワード検索
  for (const keyword of CONFIG.PERSONNEL_SEARCH_KEYWORDS) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${CONFIG.GOOGLE_SEARCH_API_KEY}&cx=${CONFIG.GOOGLE_SEARCH_ENGINE_ID}&q=${encodeURIComponent(keyword)}&dateRestrict=d7&num=3`;
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      Logger.log(`Google News人事[${keyword}]: HTTP ${response.getResponseCode()}`);
      if (response.getResponseCode() !== 200) {
        Logger.log(`レスポンス: ${response.getContentText().substring(0, 200)}`);
        continue;
      }

      const data = JSON.parse(response.getContentText());
      if (!data.items) continue;

      for (const item of data.items) {
        articles.push({
          title: item.title,
          url: item.link,
          source: 'Google News(人事)',
          description: item.snippet || '',
          isPersonnel: true,
          publishedAt: '',
        });
      }
    } catch (e) {
      Logger.log(`Google News人事検索エラー [${keyword}]: ${e.message}`);
    }
  }

  // 業界ニュースキーワード検索
  for (const keyword of CONFIG.SEARCH_KEYWORDS) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${CONFIG.GOOGLE_SEARCH_API_KEY}&cx=${CONFIG.GOOGLE_SEARCH_ENGINE_ID}&q=${encodeURIComponent(keyword)}&dateRestrict=d7&num=3`;
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) continue;

      const data = JSON.parse(response.getContentText());
      if (!data.items) continue;

      for (const item of data.items) {
        articles.push({
          title: item.title,
          url: item.link,
          source: 'Google News',
          description: item.snippet || '',
          isPersonnel: false,
          publishedAt: '',
        });
      }
    } catch (e) {
      Logger.log(`Google News業界検索エラー [${keyword}]: ${e.message}`);
    }
  }

  return articles;
}

// ── カテゴリ別分類＆ダイジェスト生成（Claude APIなし版） ────
function generateDigest(articles) {
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');

  // 重複URLを除去
  const seen = new Set();
  const unique = articles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  // カテゴリ分類
  const personnel = unique.filter(a => a.isPersonnel).slice(0, CONFIG.MAX_ARTICLES_PER_CATEGORY);
  const industry = unique.filter(a => !a.isPersonnel).slice(0, CONFIG.MAX_ARTICLES_PER_CATEGORY);

  const formatArticles = (list) => {
    if (list.length === 0) return '• 本日は該当情報なし';
    return list.map(a => `• <${a.url}|${a.title}>（${a.source}）`).join('\n');
  };

  return `📰 *メディア業界 日次ダイジェスト｜${today}*

👤 *人事情報*（就任・退任・退職・異動など）
${formatArticles(personnel)}

📢 *メディア業界ニュース*（業界動向・掲載媒体の最新情報）
${formatArticles(industry)}

_このメッセージはGASで自動生成されています_`;
}

// ── Slack投稿 ────────────────────────────────────────────────
function postToSlack(message) {
  const payload = {
    channel: CONFIG.SLACK_CHANNEL_ID,
    text: message,
    unfurl_links: false,
    unfurl_media: false,
  };

  const response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.SLACK_BOT_TOKEN,
      'Content-Type': 'application/json; charset=utf-8',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const result = JSON.parse(response.getContentText());
  if (!result.ok) {
    throw new Error('Slack投稿エラー: ' + result.error);
  }
}

function notifyError(errorMsg) {
  try {
    const payload = {
      channel: CONFIG.SLACK_CHANNEL_ID,
      text: `⚠️ メディアダイジェスト自動投稿でエラーが発生しました\n\`\`\`${errorMsg}\`\`\``,
    };
    UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + CONFIG.SLACK_BOT_TOKEN,
        'Content-Type': 'application/json; charset=utf-8',
      },
      payload: JSON.stringify(payload),
    });
  } catch (e) {
    Logger.log('エラー通知失敗: ' + e.message);
  }
}

// ── 時間トリガーの設定（初回のみ手動で実行） ────────────────
function setDailyTrigger() {
  // 既存トリガーを削除
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runDailyMediaIntelligence') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 毎朝9時（JST）に実行
  ScriptApp.newTrigger('runDailyMediaIntelligence')
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();

  Logger.log('トリガー設定完了：毎朝9時に自動実行');
}

// ── 人事記事確認用（マッチした記事を全件ログ出力） ────────────
function testPersonnelArticles() {
  const articles = collectFromRSS();
  Logger.log(`RSS全件数: ${articles.length}件`);

  const personnel = articles.filter(a => a.isPersonnel);
  Logger.log(`人事情報マッチ: ${personnel.length}件`);

  if (personnel.length > 0) {
    personnel.forEach(a => Logger.log(`👤 [${a.source}] ${a.title}`));
  } else {
    Logger.log('人事情報なし。全記事タイトルを確認:');
    articles.slice(0, 20).forEach(a => Logger.log(`  [${a.source}] ${a.title}`));
  }
}

// ── RSSテスト用（各フィードの取得状況を確認） ────────────────
function testRSSFeeds() {
  for (const feed of CONFIG.RSS_FEEDS) {
    try {
      const response = UrlFetchApp.fetch(feed.url, { muteHttpExceptions: true });
      const code = response.getResponseCode();
      if (code !== 200) {
        Logger.log(`❌ ${feed.label} [${feed.url}] → HTTPエラー: ${code}`);
        continue;
      }
      const xml = XmlService.parse(response.getContentText());
      const root = xml.getRootElement();
      const items = root.getChildren('channel').length > 0
        ? root.getChild('channel').getChildren('item')
        : root.getChildren('entry', XmlService.getNamespace('http://www.w3.org/2005/Atom'));
      Logger.log(`✅ ${feed.label} [${feed.url}] → ${items.length}件取得`);
      if (items.length > 0) {
        const first = items[0];
        const title = first.getChild('title') ? first.getChild('title').getText() : '(タイトルなし)';
        Logger.log(`   最新記事: ${title}`);
      }
    } catch (e) {
      Logger.log(`❌ ${feed.label} [${feed.url}] → エラー: ${e.message}`);
    }
  }
}

// ── テスト用（Slack投稿なし・ログ出力のみ） ──────────────────
function testWithoutSlack() {
  const allArticles = [];

  const rssArticles = collectFromRSS();
  allArticles.push(...rssArticles);
  Logger.log(`RSS収集: ${rssArticles.length}件`);

  const newsArticles = collectFromGoogleNews();
  allArticles.push(...newsArticles);
  Logger.log(`Google News収集: ${newsArticles.length}件`);

  if (allArticles.length === 0) {
    Logger.log('収集した記事がありません');
    return;
  }

  const digest = generateDigest(allArticles);
  Logger.log('===== 投稿プレビュー =====');
  Logger.log(digest);
  Logger.log('========================');
  Logger.log('※ Slackには投稿していません');
}

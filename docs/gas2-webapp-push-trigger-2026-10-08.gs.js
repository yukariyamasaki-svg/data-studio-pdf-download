/**
 * GAS②（ダブルチェック）向け修正パッチ（2026-10-08・Webアプリ化）
 *
 * 元のプロジェクト（このリポジトリの範囲外）:
 *   https://script.google.com/home/projects/1RbTEF52nZDsHUrH3P8CUxk_kQMriDd70d9ZDB9J9Qr7kqkxFJcTaatWp/edit?hl=ja
 *
 * 背景:
 *   GAS②は現在、時間主導トリガーでポーリングしている。GAS①がBox転送を終えた
 *   直後にGAS①自身がこのWebアプリを呼び出すことで、ダブルチェックを即時に
 *   開始できるようにする。既存の時間主導トリガーは削除せず、頻度を落として
 *   安全網（プッシュが届かなかった場合のフォールバック）として残す。
 *
 * 適用方法:
 *   1. 下の doPost(e) 関数（新規関数）をプロジェクトのどこかに追加する
 *      （startReconcile()自体は docs/gas2-startreconcile-fix-2026-10-08-canvas.gs.js
 *      の内容のまま変更不要）。
 *   2. スクリプトプロパティに TRIGGER_SECRET を設定する
 *      （GAS①側スクリプトプロパティのGAS2_TRIGGER_SECRETと同じ値にする）。
 *   3. エディタ右上「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」で公開する。
 *        - 実行するユーザー: 自分（このスクリプトを所有するアカウント）
 *        - アクセスできるユーザー: 全員
 *      発行されたURLを、GAS①のスクリプトプロパティGAS2_WEBAPP_URLに設定する。
 *   4. 既存の時間主導トリガーは削除せず、頻度を落とす（例: 1時間おき）。
 *      プッシュ起動が届かなかった場合の安全網として機能する。
 *
 * 認証方式について:
 *   GASのWebアプリは未認証(ANYONE)でもURLを知らない限り到達されない上、
 *   doPost側でリクエストボディ内の共有シークレットをスクリプトプロパティと
 *   照合してから本処理を実行するため、URLが漏洩しただけでは実行できない。
 */

function doPost(e) {
  const expected = PropertiesService.getScriptProperties().getProperty('TRIGGER_SECRET');
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'invalid JSON' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (!expected || payload.secret !== expected) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  startReconcile();

  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * GAS①（自動実行_リネームとBox転送）向け修正パッチ（2026-10-08・Webアプリ化）
 *
 * 元のプロジェクト（このリポジトリの範囲外）:
 *   自動実行_リネームとBox転送: https://script.google.com/home/projects/1KNzq3wKy8DSOhFXCcPnjwf5krWc5dZR1LCGzRV8G4CSZnmftf8Uc7-vI/edit
 *
 * 背景:
 *   GAS①は現在「毎分」の時間主導トリガーでポーリングしており、2026-09-03に
 *   UrlFetchApp日次quota超過でBox転送が丸ごと止まった原因もこれだった。
 *   data-studio-pdf-download（GitHub Actions）がDriveへのPDFアップロードを
 *   完了した直後にこのWebアプリを呼び出すことで、「毎分空振り」をやめて
 *   「必要なときだけ即実行」に変える。既存の毎分トリガーは削除せず、頻度を
 *   落として安全網（プッシュが届かなかった場合のフォールバック）として残す。
 *
 * 適用方法:
 *   1. 下の doPost(e)・triggerGas2_ の2関数（新規関数）をプロジェクトのどこかに追加する。
 *   2. docs/gas1-mainflow-fix-2026-10-08-canvas.gs.js 適用済みの自動実行_リネームとBox転送()
 *      を、下の全文で置き換える（追加されるのは末尾のtriggerGas2_()呼び出し1行のみ）。
 *   3. スクリプトプロパティに以下を設定する:
 *        TRIGGER_SECRET      ... GitHub Actionsからの呼び出しを検証する共有シークレット
 *                                （openssl rand -hex 32 等で生成し、GitHub Secretsの
 *                                GAS1_TRIGGER_SECRETと同じ値にする）
 *        GAS2_WEBAPP_URL     ... GAS②のWebアプリURL（手順4で発行）
 *        GAS2_TRIGGER_SECRET ... GAS②のdoPostが検証するシークレット
 *                                （GAS②側スクリプトプロパティのTRIGGER_SECRETと同じ値にする）
 *   4. エディタ右上「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」で公開する。
 *        - 実行するユーザー: 自分（このスクリプトを所有するアカウント）
 *        - アクセスできるユーザー: 全員
 *      発行されたURLを GAS1_WEBAPP_URL としてGitHub Secretsに設定する
 *      （schedule.ymlの「Trigger GAS①」ステップが使う）。
 *   5. 既存の「毎分」時間主導トリガーは削除せず、頻度を落とす（例: 1時間おき）。
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

  自動実行_リネームとBox転送();

  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 自動実行_リネームとBox転送()の末尾にtriggerGas2_()を1行追加する（既存のmainFlow呼び出し
// 2行はdocs/gas1-mainflow-fix-2026-10-08-canvas.gs.jsの内容のまま変更不要）。
// プッシュ起動・毎分フォールバック起動のどちらで呼ばれても、この関数の最後で
// 必ずGAS②へプッシュ起動を試みる。
function 自動実行_リネームとBox転送() {
  mainFlow('rename');
  mainFlow('upload');
  triggerGas2_(); // 2026-10-08追記
}

// GAS②のWebアプリへプッシュ起動する。GAS2_WEBAPP_URL/GAS2_TRIGGER_SECRETが
// 未設定の間はログに警告を出すだけでスキップし、GAS②自身の時間主導トリガー
// （フォールバック）に処理を委ねる。失敗時も例外を投げず、呼び出し元の
// mainFlow結果（Box転送・通知メール下書き・Canvas更新）には影響させない。
function triggerGas2_() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('GAS2_WEBAPP_URL');
  const secret = props.getProperty('GAS2_TRIGGER_SECRET');
  if (!url || !secret) {
    Logger.log('⚠️ GAS2_WEBAPP_URL/GAS2_TRIGGER_SECRET未設定のため、GAS②へのプッシュ起動をスキップします（毎分→低頻度フォールバックトリガーに委ねます）。');
    return;
  }
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ secret: secret }),
      muteHttpExceptions: true
    });
    Logger.log('◯ GAS②へプッシュ起動しました: ' + res.getContentText());
  } catch (e) {
    Logger.log('✕ GAS②へのプッシュ起動に失敗しました（フォールバックトリガーに委ねます）: ' + e.toString());
  }
}

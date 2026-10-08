/**
 * GAS①（自動実行_リネームとBox転送）向け追加修正パッチ（2026-10-08・triggerGas2_のBearer化）
 *
 * 背景:
 *   GAS②のWebアプリも、GAS①と同じSmartNews, Inc Workspaceポリシーの制約により
 *   「アクセスできるユーザー: SmartNews, Inc内の全員」でしかデプロイできない見込み
 *   （GAS①で実際に確認済み）。そのままだと、GAS①からtriggerGas2_()で行う
 *   UrlFetchApp.fetchは未認証のPOSTになり、GitHub Actionsから素のPOSTで
 *   GAS①を呼んだときと同じく401で拒否される可能性が高い。
 *
 *   GitHub Actions側はGoogle OAuthクレデンシャルで取得したアクセストークンを
 *   Bearerとして付与することでこれを回避した。GAS側では同じ役割を
 *   ScriptApp.getOAuthToken()が果たす（このスクリプトを所有する smartnews.com
 *   ユーザー自身のOAuthトークンを返す、追加の認可設定は不要）。
 *
 * 適用方法:
 *   既存のtriggerGas2_()関数全文を、下の内容で丸ごと置き換える
 *   （差分はheadersに Authorization: 'Bearer ' + ScriptApp.getOAuthToken() を
 *   追加した1点のみ）。
 */
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
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ secret: secret }),
      muteHttpExceptions: true
    });
    Logger.log('◯ GAS②へプッシュ起動しました: ' + res.getContentText());
  } catch (e) {
    Logger.log('✕ GAS②へのプッシュ起動に失敗しました（フォールバックトリガーに委ねます）: ' + e.toString());
  }
}

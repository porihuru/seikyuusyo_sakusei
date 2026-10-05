/* 配布先で設定します。イントラのホスト名・パスワードを公開リポジトリに記載しないでください。
 * アプリをSharePointと同じ接続元で開き、ブラウザのログイン状態を使用します。 */
window.INVOICE_SHAREPOINT_CONFIG = {
  mode: 'intranet',
  // 同じホスト内のサイトパス。Lists以降は含めません。
  siteUrl: '',
  addressList: '請求書宛先マスタ',
  vendorList: '請求書業者マスタ',
  // 他人の情報の更新ボタンを表示するSharePointユーザーID（文字列）。権限はサーバー側で設定。
  adminUserIds: []
};

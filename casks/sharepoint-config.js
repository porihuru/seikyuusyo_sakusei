/* 管理者が事前に接続情報を入力し、全利用者にこのファイルを配布します。
 * アプリの接続設定はこのファイルだけを使用します。
 * 公開してよい情報だけを設定します。秘密鍵・パスワードは記載しません。
 * 詳細は SHAREPOINT_SETUP.md を参照。未設定時は同梱テストCSVを表示します。 */
window.INVOICE_SHAREPOINT_CONFIG = {
  tenantId: '',
  clientId: '',
  siteUrl: '',
  addressList: '請求書宛先マスタ',
  vendorList: '請求書業者マスタ',
  // 更新ボタンを表示する管理者のEntraオブジェクトID。権限はSharePoint側でも設定します。
  adminObjectIds: []
};

// ============================================================
// LT-ERP 簡易銷貨單 — 設定（公開的，可放 git）
// ============================================================
// ⚠️ 這個檔案會被打包進靜態網站、推到 GitHub Public Repo
// 只能放：
//   ✅ Supabase URL（公開）
//   ✅ anon key（公開的 JWT，僅給 supabase-js 用，本身有 RLS 保護）
//   ✅ ALLOWED_ROLES（檢查邏輯，不是 secret）
// 不能放：
//   ❌ admin_secret（給 16staff Apps Script 用）
//   ❌ store_secret（給各店 Sheet 用）
//   ❌ service_role key（任何情況都不該前端用）
// ============================================================

window.LT_CONFIG = {
  SB_URL: 'https://asugjynpocwygggttxyo.supabase.co',
  SB_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzdWdqeW5wb2N3eWdnZ3R0eHlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNzU3MjksImV4cCI6MjA4ODk1MTcyOX0.LzcRQAl80rZxKKD8NIYWGvylfwCbs1ek5LtKpmZodBc',
  ALLOWED_ROLES: ['admin', 'assistant']
};

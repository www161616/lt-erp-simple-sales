// ============================================================
// LT-ERP 簡易銷貨單 — Supabase Auth wrapper
// ============================================================
// 依賴：
//   - LT_CONFIG (config.js)
//   - window.supabase (CDN @supabase/supabase-js@2)
// 公開：
//   - window.sb            : Supabase client（給 RPC / Auth 用）
//   - window.ltLogin       : email + password 登入 + role 檢查
//   - window.ltLogout      : 登出
//   - window.ltGetSession  : 取目前 session
//   - window.ltGetUser     : 取目前使用者（email + role）
// ============================================================

(function () {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('supabase-js 未載入（檢查 CDN script tag）');
  }
  window.sb = window.supabase.createClient(
    LT_CONFIG.SB_URL,
    LT_CONFIG.SB_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    }
  );
})();


// 登入 + role 檢查（不是 admin/assistant 自動 signOut）
window.ltLogin = async function (email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message || '登入失敗');

  const role = (data.user && data.user.user_metadata && data.user.user_metadata.role) || '';
  if (LT_CONFIG.ALLOWED_ROLES.indexOf(role) < 0) {
    await sb.auth.signOut({ scope: 'local' });
    throw new Error('權限不足：此帳號 role = "' + role + '"，需要 admin 或 assistant');
  }
  return { email: data.user.email, role: role };
};


// 登出（local scope，避免 anon key 全域登出限制）
window.ltLogout = async function () {
  await sb.auth.signOut({ scope: 'local' });
};


// 取目前 session（含 access_token）
window.ltGetSession = async function () {
  const { data, error } = await sb.auth.getSession();
  if (error) return null;
  return data.session;
};


// 取目前使用者（簡化資訊）
window.ltGetUser = async function () {
  const session = await ltGetSession();
  if (!session || !session.user) return null;
  return {
    email: session.user.email,
    role: (session.user.user_metadata && session.user.user_metadata.role) || ''
  };
};

// ============================================================
// LT-ERP 簡易銷貨單 — 主畫面 SPA 邏輯
// ============================================================
// B 段第一版：登入 + role 檢查 + 登出
// C 段會擴：列表、篩選、明細 modal
// D 段會擴：列印頁
// ============================================================

// view 切換
function showView(name) {
  document.getElementById('boot-view').style.display  = (name === 'boot')  ? '' : 'none';
  document.getElementById('login-view').style.display = (name === 'login') ? '' : 'none';
  document.getElementById('main-view').style.display  = (name === 'main')  ? '' : 'none';
}


// 進入主畫面
function enterMain(user) {
  document.getElementById('current-user').textContent = user.email + ' (' + user.role + ')';
  showView('main');
}


// 登入頁送出
document.getElementById('login-form').addEventListener('submit', async function (e) {
  e.preventDefault();

  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const btn      = document.getElementById('login-btn');
  const errEl    = document.getElementById('login-error');

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = '登入中...';

  try {
    const user = await ltLogin(email, password);
    enterMain(user);
  } catch (err) {
    errEl.textContent = '❌ ' + err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '登入';
  }
});


// 登出
document.getElementById('logout-btn').addEventListener('click', async function () {
  try {
    await ltLogout();
  } catch (err) {
    // 即使登出失敗（網路問題），也回登入頁
    console.error('logout error', err);
  }
  document.getElementById('email').value = '';
  document.getElementById('password').value = '';
  showView('login');
});


// onAuthStateChange — JWT 過期或被踢時自動回登入頁
sb.auth.onAuthStateChange(function (event, session) {
  if (event === 'SIGNED_OUT') {
    showView('login');
  } else if (event === 'TOKEN_REFRESHED') {
    // refresh 成功，不用做事
  }
});


// 初始化：檢查既有 session
(async function init() {
  showView('boot');
  try {
    const user = await ltGetUser();
    if (user && LT_CONFIG.ALLOWED_ROLES.indexOf(user.role) >= 0) {
      enterMain(user);
    } else {
      // 沒登入 / role 不對 → 顯示登入頁
      if (user) {
        // 已登入但 role 不對 → 強制登出
        await ltLogout();
      }
      showView('login');
    }
  } catch (err) {
    console.error('init error', err);
    showView('login');
  }
})();

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
  populateStoreSelect();

  // ⚡ deep link：?order=SS-XXX → 自動帶入搜尋 + 直接開明細 modal
  var urlOrder = '';
  try {
    urlOrder = (new URLSearchParams(window.location.search)).get('order') || '';
  } catch (e) { /* 舊瀏覽器 fallback：略 */ }

  if (urlOrder && urlOrder.indexOf('SS-') === 0) {
    // 把搜尋 filter 設成該單號，日期不限（讓清單也找得到）
    document.getElementById('filter-search').value = urlOrder;
    document.getElementById('filter-from').value = '';
    document.getElementById('filter-to').value   = '';
    // 清掉「今日」按鈕的 active
    var btns = document.querySelectorAll('.quick-buttons button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');

    // 列表跑背景，立即開 modal
    doSearch();
    openDetailModal(urlOrder);
    // 清掉 URL 參數，避免 reload 又自動開
    try { history.replaceState({}, '', window.location.pathname); } catch (e) {}
    return;
  }

  applyDateRange('today');
  doSearch();
}


// ============================================================
// C 段：篩選 / 列表 / 明細 modal
// ============================================================

const STORES = [
  '三峽','中和','文山','四號','永和','忠順',
  '環球','平鎮','古華','林口','南平','泰山',
  '萬華','湖口','經國','松山','全民','龍潭'
];

function populateStoreSelect() {
  const sel = document.getElementById('filter-store');
  // 保留第一個 "全部"，重新塞 18 家
  while (sel.options.length > 1) sel.remove(1);
  for (let i = 0; i < STORES.length; i++) {
    const opt = document.createElement('option');
    opt.value = STORES[i];
    opt.textContent = STORES[i];
    sel.appendChild(opt);
  }
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function fmtDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function getQuickRange(quick) {
  const today = new Date();
  if (quick === 'today') {
    return { from: fmtDate(today), to: fmtDate(today) };
  } else if (quick === 'tomorrow') {
    const t = new Date(today.getTime() + 86400000);
    return { from: fmtDate(t), to: fmtDate(t) };
  } else if (quick === '7days') {
    const back = new Date(today.getTime() - 6 * 86400000);
    return { from: fmtDate(back), to: fmtDate(today) };
  } else if (quick === '30days') {
    const back = new Date(today.getTime() - 29 * 86400000);
    return { from: fmtDate(back), to: fmtDate(today) };
  }
  return { from: '', to: '' };
}

function applyDateRange(quick) {
  const r = getQuickRange(quick);
  document.getElementById('filter-from').value = r.from;
  document.getElementById('filter-to').value   = r.to;
  // active button 標示
  const btns = document.querySelectorAll('.quick-buttons button');
  for (let i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].dataset.quick === quick);
  }
}

function getCurrentFilters() {
  return {
    from:         document.getElementById('filter-from').value || null,
    to:           document.getElementById('filter-to').value   || null,
    store:        document.getElementById('filter-store').value || null,
    status:       document.getElementById('filter-status').value || null,
    returnStatus: document.getElementById('filter-return').value || null,
    search:       document.getElementById('filter-search').value.trim() || null,
    limit:        500
  };
}

function setStatusBar(msg, type) {
  const el = document.getElementById('status-bar');
  if (!msg) { el.style.display = 'none'; return; }
  el.className = 'status-bar status-' + (type || 'info');
  el.textContent = msg;
  el.style.display = '';
}

// 當前可列印的非暫存單號（給批次列印按鈕用）
let _lastPrintableOrders = [];

function updateBatchPrintButton() {
  const btn      = document.getElementById('btn-batch-print');
  const btnExcel = document.getElementById('btn-export-excel');
  const n = _lastPrintableOrders.length;
  if (n === 0) {
    if (btn)      btn.style.display = 'none';
    if (btnExcel) btnExcel.style.display = 'none';
  } else {
    if (btn) {
      btn.style.display = '';
      btn.textContent = '📄 列印當前列表（' + n + ' 張）';
    }
    if (btnExcel) {
      btnExcel.style.display = '';
      btnExcel.textContent = '📊 匯出 Excel（' + n + ' 張）';
    }
  }
}

async function doSearch() {
  setStatusBar('查詢中...', 'info');
  const tbody = document.getElementById('orders-tbody');
  tbody.innerHTML = '<tr><td colspan="9" class="empty">⏳ 載入中...</td></tr>';
  _lastPrintableOrders = [];
  updateBatchPrintButton();

  try {
    const filters = getCurrentFilters();
    const rows = await ltGetAllOrders(filters);
    let arr = Array.isArray(rows) ? rows : [];

    // ⚡ 任務 4.1 D 段：status filter 為空時排除暫存單（is_draft=true）
    //   要看暫存單必須明確選「📝 暫存」（後端 status='暫存' 自動只回暫存）
    let draftHiddenCount = 0;
    if (!filters.status) {
      const before = arr.length;
      arr = arr.filter(o => !o.is_draft);
      draftHiddenCount = before - arr.length;
    }

    if (arr.length === 0) {
      const suffix = draftHiddenCount > 0
        ? '（已隱藏 ' + draftHiddenCount + ' 張暫存單，要看請選狀態「📝 暫存」）'
        : '（無符合資料）';
      setStatusBar('共 0 筆 ' + suffix, 'info');
    } else if (arr.length >= 1000) {
      setStatusBar('共 ' + arr.length + ' 筆（已達上限 1000，建議縮小篩選範圍）', 'warning');
    } else {
      let msg = '共 ' + arr.length + ' 筆';
      if (draftHiddenCount > 0) {
        msg += '（另有 ' + draftHiddenCount + ' 張暫存單已隱藏，要看請選狀態「📝 暫存」）';
      }
      setStatusBar(msg, 'success');
    }
    renderOrders(arr);

    // 任務 4 D 段：把可列印的非暫存單號收集起來給批次列印
    _lastPrintableOrders = arr.filter(o => !o.is_draft).map(o => o.order_no);
    updateBatchPrintButton();
  } catch (err) {
    setStatusBar('❌ 查詢失敗：' + err.message, 'error');
    tbody.innerHTML = '<tr><td colspan="9" class="empty">查詢失敗</td></tr>';
  }
}

function doBatchPrint() {
  const orders = _lastPrintableOrders;
  if (!orders || orders.length === 0) {
    alert('沒有可列印的單（暫存單不可列印）');
    return;
  }
  if (orders.length > 100) {
    alert('一次最多 100 張，目前 ' + orders.length + ' 張。請先縮小篩選範圍。');
    return;
  }
  // 確認彈窗（10 張以上才問，避免 admin 點按鈕後又被打斷）
  if (orders.length >= 10) {
    if (!confirm('確定要列印 ' + orders.length + ' 張銷貨單？\n\n會在新分頁開啟列印頁，每張單獨立 A5 一頁。')) {
      return;
    }
  }
  const url = 'print.html?orders=' + encodeURIComponent(orders.join(','));
  window.open(url, '_blank');
}


// ============================================================
// Excel 匯出（任務 4 D 段補充）
// ============================================================
async function doExportExcel() {
  const orders = _lastPrintableOrders;
  if (!orders || orders.length === 0) {
    alert('沒有可匯出的資料（暫存單不會匯出）');
    return;
  }
  if (orders.length > 100) {
    alert('一次最多 100 張，目前 ' + orders.length + ' 張。請先縮小篩選範圍。');
    return;
  }
  if (typeof XLSX === 'undefined') {
    alert('XLSX library 未載入，請重整頁面再試');
    return;
  }

  setStatusBar('Excel 匯出中（拉資料）...', 'info');

  let result;
  try {
    result = await ltGetOrdersBatch(orders);
  } catch (err) {
    setStatusBar('❌ 匯出失敗：' + err.message, 'error');
    return;
  }

  // 組明細列表
  const rows = [];
  let totalQty = 0;
  let totalAmount = 0;
  let validOrderCount = 0;
  for (let i = 0; i < result.length; i++) {
    const entry = result[i];
    if (entry.missing || entry.draft_blocked) continue;
    const o = entry.order || {};
    const items = entry.items || [];
    validOrderCount++;
    for (let j = 0; j < items.length; j++) {
      const it = items[j];
      const subtotal = Number(it.subtotal) || 0;
      const qty = it.qty || 0;
      rows.push({
        '單號':     o.order_no || '',
        '店家':     o.store_name || '',
        '訂單日':   o.order_date || '',
        '出貨日':   o.delivery_date || '',
        '商品編號': it.product_id || '',
        '商品名稱': it.product_name || '',
        '數量':     qty,
        '單價':     Number(it.unit_price) || 0,
        '小計':     subtotal,
        '訂單狀態': o.status || '',
        '退貨狀態': it.return_status || '無'
      });
      totalQty += qty;
      totalAmount += subtotal;
    }
  }

  if (rows.length === 0) {
    setStatusBar('❌ 無有效明細可匯出', 'error');
    return;
  }

  // 加合計列
  rows.push({
    '單號':     '【合計】',
    '店家':     '',
    '訂單日':   '',
    '出貨日':   '',
    '商品編號': '',
    '商品名稱': validOrderCount + ' 張單，' + (rows.length) + ' 筆明細',
    '數量':     totalQty,
    '單價':     '',
    '小計':     totalAmount,
    '訂單狀態': '',
    '退貨狀態': ''
  });

  // 產生 workbook
  const ws = XLSX.utils.json_to_sheet(rows);
  // 欄寬
  ws['!cols'] = [
    { wch: 18 }, // 單號
    { wch: 8 },  // 店家
    { wch: 12 }, // 訂單日
    { wch: 12 }, // 出貨日
    { wch: 12 }, // 商品編號
    { wch: 32 }, // 商品名稱
    { wch: 6 },  // 數量
    { wch: 8 },  // 單價
    { wch: 10 }, // 小計
    { wch: 10 }, // 訂單狀態
    { wch: 10 }  // 退貨狀態
  ];
  // 強制單號（A 欄）+ 商品編號（E 欄）為文字格式（避免長數字變科學記號）
  for (let r = 2; r <= rows.length + 1; r++) {
    const cellA = ws['A' + r];
    if (cellA) { cellA.t = 's'; cellA.z = '@'; }
    const cellE = ws['E' + r];
    if (cellE) { cellE.t = 's'; cellE.z = '@'; }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '銷貨單明細');

  const now = new Date();
  const filename = '銷貨單_'
    + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate())
    + '-' + pad2(now.getHours()) + pad2(now.getMinutes())
    + '.xlsx';
  XLSX.writeFile(wb, filename);

  setStatusBar('✅ 已匯出 ' + filename + '（' + validOrderCount + ' 張單，' + (rows.length - 1) + ' 筆明細）', 'success');
}

function doReset() {
  document.getElementById('filter-store').value  = '';
  document.getElementById('filter-status').value = '';
  document.getElementById('filter-return').value = '';
  document.getElementById('filter-search').value = '';
  applyDateRange('today');
  doSearch();
}

function renderOrders(orders) {
  const tbody = document.getElementById('orders-tbody');
  if (!orders || orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">沒有符合的訂單</td></tr>';
    return;
  }
  let html = '';
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const isDraft = !!o.is_draft;
    const rowClass = isDraft ? ' class="draft-row"' : '';
    html += '<tr' + rowClass + '>';
    html += '<td><a data-order="' + escAttr(o.order_no) + '" class="order-link">' + escHtml(o.order_no) + '</a></td>';
    html += '<td>' + escHtml(o.store_name) + '</td>';
    html += '<td>' + (o.order_date    || '') + '</td>';
    html += '<td>' + (o.delivery_date || '') + '</td>';
    html += '<td class="r">' + (o.total_qty || 0) + '</td>';
    html += '<td class="r">$' + (Number(o.total_amount) || 0).toLocaleString() + '</td>';
    if (isDraft) {
      html += '<td><span class="badge b-draft">📝 暫存</span></td>';
    } else {
      html += '<td><span class="badge ' + statusClass(o.status) + '">' + escHtml(o.status) + '</span></td>';
    }
    if (o.has_return) {
      html += '<td><span class="badge ' + returnClass(o.return_status) + '">' + escHtml(o.return_status) + '</span></td>';
    } else {
      html += '<td><small style="color:#999;">-</small></td>';
    }
    if (isDraft) {
      html += '<td class="c"><button class="btn-mini" disabled title="暫存單不可列印">🚫</button></td>';
    } else {
      html += '<td class="c"><button class="btn-mini" disabled title="D 段開放">📄</button></td>';
    }
    html += '</tr>';
  }
  tbody.innerHTML = html;

  // 單號連結事件 delegation
  const links = tbody.querySelectorAll('.order-link');
  for (let i = 0; i < links.length; i++) {
    links[i].addEventListener('click', function () {
      openDetailModal(this.dataset.order);
    });
  }
}


// ============================================================
// 明細 modal
// ============================================================

async function openDetailModal(orderNo) {
  document.getElementById('detail-modal').style.display = '';
  document.getElementById('modal-body').innerHTML = '<div class="loading">⏳ 載入中...</div>';

  try {
    const data = await ltGetOrderDetails(orderNo);
    renderModalBody(data);
  } catch (err) {
    document.getElementById('modal-body').innerHTML =
      '<div class="status-bar status-error">❌ ' + escHtml(err.message) + '</div>';
  }
}

function closeDetailModal() {
  document.getElementById('detail-modal').style.display = 'none';
}

function renderModalBody(data) {
  const o = (data && data.order) || {};
  const items = (data && data.items) || [];
  const isDraft = !!o.is_draft;
  let html = '';

  html += '<h2 class="modal-title">' + escHtml(o.order_no) + ' / ' + escHtml(o.store_name);
  if (isDraft) {
    html += '<span class="badge b-draft">📝 暫存</span>';
  } else {
    html += '<span class="badge ' + statusClass(o.status) + '">' + escHtml(o.status) + '</span>';
  }
  html += '</h2>';

  html += '<div class="modal-meta">';
  html += '<span>📅 訂單：' + (o.order_date || '-') + '</span>';
  html += '<span>🚚 出貨：' + (o.delivery_date || '-') + '</span>';
  html += '<span>📦 ' + (o.total_qty || 0) + ' 件</span>';
  html += '<span>💰 $' + (Number(o.total_amount) || 0).toLocaleString() + '</span>';
  if (o.picker_email) html += '<span>👤 ' + escHtml(o.picker_email) + '</span>';
  if (o.received_at) html += '<span>✅ 收貨：' + formatTs(o.received_at) + '</span>';
  if (o.has_return) html += '<span class="return-badge">⚠️ 退貨：' + escHtml(o.return_status) + '</span>';
  html += '</div>';

  // ⚡ 任務 4.1 D 段：暫存單警示框
  if (isDraft) {
    html += '<div class="draft-warn">';
    html +=   '<b>⚠️ 此單為暫存單，數量與品項仍可能調整</b><br/>';
    html +=   '尚未由撿貨員確認送出，<b>不會出現在店家「待收貨」清單</b>，也不能列印。<br/>';
    html +=   '<small>要修改／確認送出 → 請到 16staff 撿貨員 Sheet「📝 暫存銷貨單」分頁處理</small>';
    html += '</div>';
  }

  if (items.length === 0) {
    html += '<div class="status-bar status-warning">⚠️ 無明細</div>';
  } else {
    html += '<table class="modal-items">';
    html += '<thead><tr><th>編號</th><th>商品</th><th class="r">數量</th><th class="r">單價</th><th class="r">小計</th></tr></thead>';
    html += '<tbody>';
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const hasReturn = it.return_status && it.return_status !== '無';
      html += '<tr' + (hasReturn ? ' class="return-row"' : '') + '>';
      html += '<td class="mono">' + escHtml(it.product_id) + '</td>';
      html += '<td>' + escHtml(it.product_name);
      if (hasReturn) {
        html += '<br/><span class="return-info">↳ '
             + '【' + escHtml(it.report_type || '?') + '】'
             + ' ×' + (it.return_qty || 0)
             + '（退貨狀態：' + escHtml(it.return_status) + '）';
        if (it.return_reason) html += '｜原因：' + escHtml(it.return_reason);
        html += '</span>';
        if (it.admin_response) {
          html += '<br/><span class="admin-note">admin 回應：' + escHtml(it.admin_response) + '</span>';
        }
      }
      html += '</td>';
      html += '<td class="r">' + (it.qty || 0) + '</td>';
      html += '<td class="r">$' + (Number(it.unit_price) || 0).toLocaleString() + '</td>';
      html += '<td class="r">$' + (Number(it.subtotal)   || 0).toLocaleString() + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
  }

  html += '<div class="modal-actions">';
  if (isDraft) {
    html += '<button class="btn-disabled" disabled title="暫存單不可列印">🚫 暫存單不可列印</button>';
  } else {
    html += '<button class="btn-primary" id="btn-print-this">📄 列印此單</button>';
  }
  html += '<button class="btn-secondary" id="btn-close-modal-bottom">✕ 關閉</button>';
  html += '</div>';

  const body = document.getElementById('modal-body');
  body.innerHTML = html;
  body.querySelector('#btn-close-modal-bottom').addEventListener('click', closeDetailModal);
  // ⚡ 任務 4 D 段：列印此單 → 開新分頁跳到 print.html
  const btnPrint = body.querySelector('#btn-print-this');
  if (btnPrint && !isDraft) {
    btnPrint.addEventListener('click', function () {
      const url = 'print.html?orders=' + encodeURIComponent(o.order_no);
      window.open(url, '_blank');
    });
  }
}


// ============================================================
// 工具
// ============================================================

function statusClass(s) {
  if (s === '待處理') return 'b-pending';
  if (s === '已建單') return 'b-issued';
  if (s === '已收到') return 'b-received';
  if (s === '有問題') return 'b-issue';
  return 'b-issued';
}
function returnClass(s) {
  if (s === '申請中') return 'b-pending';
  if (s === '處理中') return 'b-issued';
  if (s === '已解決') return 'b-received';
  return 'b-issued';
}
function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function formatTs(ts) {
  try {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
         + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  } catch (e) { return ts; }
}


// ============================================================
// 註冊事件
// ============================================================

(function bindFilterEvents() {
  // 快捷按鈕
  const quickBtns = document.querySelectorAll('.quick-buttons button');
  for (let i = 0; i < quickBtns.length; i++) {
    quickBtns[i].addEventListener('click', function () {
      applyDateRange(this.dataset.quick);
      doSearch();
    });
  }
  // 查詢 / 重設
  document.getElementById('btn-search').addEventListener('click', doSearch);
  document.getElementById('btn-reset').addEventListener('click', doReset);
  // 批次列印 + Excel 匯出
  document.getElementById('btn-batch-print').addEventListener('click', doBatchPrint);
  document.getElementById('btn-export-excel').addEventListener('click', doExportExcel);
  // 單號搜尋按 Enter
  document.getElementById('filter-search').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
  });
  // modal 關閉
  document.getElementById('modal-close-btn').addEventListener('click', closeDetailModal);
  document.getElementById('modal-backdrop').addEventListener('click', closeDetailModal);
  // ESC 關 modal
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      const modal = document.getElementById('detail-modal');
      if (modal && modal.style.display !== 'none') closeDetailModal();
    }
  });
})();


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

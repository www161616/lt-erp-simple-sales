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
  tbody.innerHTML = '<tr><td colspan="10" class="empty">⏳ 載入中...</td></tr>';
  _lastPrintableOrders = [];
  updateBatchPrintButton();

  try {
    const filters = getCurrentFilters();

    // 是否要併入舊系統 (legacy) 資料
    //   - 暫存 / 待處理 / 已收到 / 有問題：legacy 沒這些狀態，跳過
    //   - 退貨狀態 申請中 / 處理中 / 已解決：legacy 沒這些狀態，跳過
    const skipLegacyByStatus = filters.status && filters.status !== '已建單';
    const skipLegacyByReturn = filters.returnStatus && filters.returnStatus !== '無';
    const includeLegacy = !skipLegacyByStatus && !skipLegacyByReturn;

    // status='已建單' 時 RT 退貨單不該混進來 → 從源頭只抓 normal
    // status=null（全部）時 SO + RT 都要抓
    // returnStatus='無' 時 RT 也不該混進來（RT 整張就是退貨）→ 也只抓 normal
    let legacyOrderType = null;
    if (filters.status === '已建單' || filters.returnStatus === '無') {
      legacyOrderType = 'normal';
    }

    const calls = [ltGetAllOrders(filters)];
    if (includeLegacy) {
      calls.push(
        ltGetLegacyAllOrders({
          from:      filters.from,
          to:        filters.to,
          store:     filters.store,
          orderType: legacyOrderType,
          search:    filters.search,
          limit:     filters.limit
        }).catch(err => {
          console.warn('legacy fetch fail:', err);
          return [];
        })
      );
    }

    const results = await Promise.all(calls);
    const simpleRows = Array.isArray(results[0]) ? results[0] : [];
    const legacyRows = Array.isArray(results[1]) ? results[1] : [];

    let arr = [];
    simpleRows.forEach(o => {
      o._dataType = 'simple';
      arr.push(o);
    });
    legacyRows.forEach(o => {
      // legacy: 對齊 simple 欄位讓 render 函式好寫
      o._dataType = (o.order_type === 'return') ? 'legacy_return' : 'legacy_normal';
      o.status        = (o._dataType === 'legacy_return') ? '退貨' : '已建單';
      o.is_draft      = false;
      o.return_status = o.has_return ? '↳ 退' : null;
      arr.push(o);
    });

    // returnStatus='無' → 排除 RT 退貨單（整張就是退貨），legacy_normal 只保留 has_return=false
    //   （legacy_return 在源頭已經被 legacyOrderType='normal' 擋掉，這裡是雙重保險）
    if (filters.returnStatus === '無') {
      arr = arr.filter(o => {
        if (o._dataType === 'simple')         return true;        // simple 後端已篩
        if (o._dataType === 'legacy_return')  return false;       // RT 整張就是退貨
        return !o.has_return;                                     // legacy_normal: 沒退貨明細才算「無」
      });
    }

    // 排序：交期/訂單日 DESC → created_at DESC
    arr.sort((a, b) => {
      const aDate = String(a.delivery_date || a.order_date || '');
      const bDate = String(b.delivery_date || b.order_date || '');
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      const aCreated = String(a.created_at || '');
      const bCreated = String(b.created_at || '');
      return bCreated.localeCompare(aCreated);
    });

    // 排除暫存單（除非明確選「暫存」）— 只對 simple 生效
    let draftHiddenCount = 0;
    if (!filters.status) {
      const before = arr.length;
      arr = arr.filter(o => !o.is_draft);
      draftHiddenCount = before - arr.length;
    }

    const simpleCount = arr.filter(o => o._dataType === 'simple').length;
    const legacyCount = arr.length - simpleCount;

    if (arr.length === 0) {
      const suffix = draftHiddenCount > 0
        ? '（已隱藏 ' + draftHiddenCount + ' 張暫存單，要看請選狀態「📝 暫存」）'
        : '（無符合資料）';
      setStatusBar('共 0 筆 ' + suffix, 'info');
    } else {
      let msg = '共 ' + arr.length + ' 筆';
      if (legacyCount > 0) {
        msg += '（一般 ' + simpleCount + ' / 📜 歷史 ' + legacyCount + '）';
      }
      if (draftHiddenCount > 0) {
        msg += '（另有 ' + draftHiddenCount + ' 張暫存單已隱藏，要看請選狀態「📝 暫存」）';
      }
      const tone = (arr.length >= 1000) ? 'warning' : 'success';
      setStatusBar(msg, tone);
    }

    renderOrders(arr);

    // 批次列印 / Excel 匯出：只收 simple 非暫存單（舊單暫不支援列印）
    _lastPrintableOrders = arr
      .filter(o => o._dataType === 'simple' && !o.is_draft)
      .map(o => o.order_no);
    updateBatchPrintButton();
  } catch (err) {
    setStatusBar('❌ 查詢失敗：' + err.message, 'error');
    tbody.innerHTML = '<tr><td colspan="10" class="empty">查詢失敗</td></tr>';
  }
}

function doBatchPrint() {
  const orders = _lastPrintableOrders;
  if (!orders || orders.length === 0) {
    alert('沒有可列印的單。\n\n（📜 歷史單暫不支援列印；📝 暫存單不可列印）');
    return;
  }
  if (orders.length > 100) {
    alert('一次最多 100 張，目前 ' + orders.length + ' 張。請先縮小篩選範圍。');
    return;
  }
  // 確認彈窗（10 張以上才問，避免 admin 點按鈕後又被打斷）
  if (orders.length >= 10) {
    if (!confirm('確定要列印 ' + orders.length + ' 張銷貨單？\n\n會在新分頁開啟列印頁，每張單獨立 A4 一頁。')) {
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
    alert('沒有可匯出的資料。\n\n（📜 歷史單暫不支援匯出；📝 暫存單不會匯出）');
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
    tbody.innerHTML = '<tr><td colspan="10" class="empty">沒有符合的訂單</td></tr>';
    return;
  }
  let html = '';
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const isDraft  = !!o.is_draft;
    const isLegacy = (o._dataType === 'legacy_normal' || o._dataType === 'legacy_return');
    const isLegacyReturn = (o._dataType === 'legacy_return');

    let rowClass = '';
    if (isDraft) rowClass = 'draft-row';
    else if (isLegacy) rowClass = 'legacy-row';
    const trCls = rowClass ? ' class="' + rowClass + '"' : '';

    html += '<tr' + trCls + '>';
    html += '<td><a data-order="' + escAttr(o.order_no) + '" class="order-link">' + escHtml(o.order_no) + '</a></td>';

    // 類型欄
    if (isLegacyReturn) {
      html += '<td><span class="badge b-legacy-return" title="舊系統退貨單（沖帳）">📜 歷史退貨</span></td>';
    } else if (isLegacy) {
      html += '<td><span class="badge b-legacy" title="舊系統 4/22 之前的單">📜 歷史</span></td>';
    } else {
      html += '<td><span class="badge b-simple">📦 一般</span></td>';
    }

    html += '<td>' + escHtml(o.store_name) + '</td>';
    html += '<td>' + (o.order_date    || '') + '</td>';
    html += '<td>' + (o.delivery_date || '') + '</td>';
    html += '<td class="r">' + (o.total_qty || 0) + '</td>';

    // 金額欄：負數紅字
    const amount = Number(o.total_amount) || 0;
    const amountCls = amount < 0 ? ' negative' : '';
    const amountStr = amount < 0
      ? '-$' + Math.abs(amount).toLocaleString()
      : '$' + amount.toLocaleString();
    html += '<td class="r' + amountCls + '">' + amountStr + '</td>';

    // 狀態欄
    if (isDraft) {
      html += '<td><span class="badge b-draft">📝 暫存</span></td>';
    } else if (isLegacyReturn) {
      html += '<td><span class="badge b-return-order">退貨單</span></td>';
    } else {
      html += '<td><span class="badge ' + statusClass(o.status) + '">' + escHtml(o.status) + '</span></td>';
    }

    // 退貨欄
    if (isLegacyReturn) {
      // RT 整張就是退貨單，這欄留 -
      html += '<td><small style="color:#999;">-</small></td>';
    } else if (o.has_return) {
      const txt = o.return_status || '↳ 退';
      html += '<td><span class="badge ' + returnClass(o.return_status) + '">' + escHtml(txt) + '</span></td>';
    } else {
      html += '<td><small style="color:#999;">-</small></td>';
    }

    // 動作欄
    if (isLegacy) {
      html += '<td class="c"><button class="btn-mini" disabled title="📜 歷史單暫不支援列印">🔒</button></td>';
    } else if (isDraft) {
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

  // 依 prefix 路由：SS- → simple，SO/RT → legacy
  const isLegacy = orderNo && String(orderNo).indexOf('SS-') !== 0;

  try {
    let data;
    if (isLegacy) {
      data = await ltGetLegacyOrderDetails(orderNo);
      data._dataType = (data && data.order && data.order.order_type === 'return')
        ? 'legacy_return' : 'legacy_normal';
    } else {
      data = await ltGetOrderDetails(orderNo);
      data._dataType = 'simple';
    }
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
  const isDraft  = !!o.is_draft;
  const dataType = (data && data._dataType) || 'simple';
  const isLegacy = (dataType === 'legacy_normal' || dataType === 'legacy_return');
  const isLegacyReturn = (dataType === 'legacy_return');
  let html = '';

  html += '<h2 class="modal-title">' + escHtml(o.order_no) + ' / ' + escHtml(o.store_name);
  if (isLegacyReturn) {
    html += '<span class="badge b-legacy-return">📜 歷史退貨</span>';
  } else if (isLegacy) {
    html += '<span class="badge b-legacy">📜 歷史</span>';
  } else if (isDraft) {
    html += '<span class="badge b-draft">📝 暫存</span>';
  } else {
    html += '<span class="badge ' + statusClass(o.status) + '">' + escHtml(o.status) + '</span>';
  }
  // RT 退貨單：在標題列補「↩️ 原單」徽章
  if (isLegacyReturn && o.ref_order_no) {
    html += '<span class="badge b-ref-order" title="此退貨單沖的原銷貨單">↩️ 原單：'
         + escHtml(o.ref_order_no) + '</span>';
  }
  html += '</h2>';

  html += '<div class="modal-meta">';
  html += '<span>📅 訂單：' + (o.order_date || '-') + '</span>';
  if (!isLegacy) {
    html += '<span>🚚 出貨：' + (o.delivery_date || '-') + '</span>';
  }
  html += '<span>📦 ' + (o.total_qty || 0) + ' 件</span>';
  // 金額：負數紅字
  const amount = Number(o.total_amount) || 0;
  const amountStr = amount < 0
    ? '<span class="negative">-$' + Math.abs(amount).toLocaleString() + '</span>'
    : '$' + amount.toLocaleString();
  html += '<span>💰 ' + amountStr + '</span>';
  if (o.picker_email) html += '<span>👤 ' + escHtml(o.picker_email) + '</span>';
  if (o.received_at)  html += '<span>✅ 收貨：' + formatTs(o.received_at) + '</span>';
  if (!isLegacy && o.has_return) {
    html += '<span class="return-badge">⚠️ 退貨：' + escHtml(o.return_status) + '</span>';
  }
  html += '</div>';

  if (o.note) {
    html += '<div class="modal-note">📝 備註：' + escHtml(o.note) + '</div>';
  }

  if (isLegacy) {
    html += '<div class="legacy-warn">';
    html +=   '<b>📜 此單為舊系統（4/22 之前）資料 — 唯讀</b><br/>';
    html +=   '<small>暫不支援列印。如需列印請至舊系統 branch_admin 查詢。</small>';
    html += '</div>';
  } else if (isDraft) {
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
      // 退貨欄位：legacy 舊資料是英文，需翻譯；'none'/'NULL'/'' 視為無
      const rsRaw = String(it.return_status || '').trim();
      const rsLow = rsRaw.toLowerCase();
      const rsValid = rsRaw && rsLow !== 'none' && rsLow !== 'null' && rsRaw !== '無';
      const hasReturnQty = (Number(it.return_qty) || 0) > 0;
      // RT 整張就是退貨單，明細不再標 ↳
      const showReturnNote = !isLegacyReturn && (rsValid || hasReturnQty);

      const rowClass = showReturnNote ? ' class="return-row"' : '';
      const subtotal = Number(it.subtotal) || 0;
      const subtotalStr = subtotal < 0
        ? '<span class="negative">-$' + Math.abs(subtotal).toLocaleString() + '</span>'
        : '$' + subtotal.toLocaleString();

      html += '<tr' + rowClass + '>';
      html += '<td class="mono">' + escHtml(it.product_id) + '</td>';
      html += '<td>' + escHtml(it.product_name);
      if (showReturnNote) {
        const reportTypeText = isLegacy ? translateReportType(it.report_type) : (it.report_type || '?');
        const returnStatusText = isLegacy ? translateReturnStatus(rsRaw) : rsRaw;
        html += '<br/><span class="return-info">↳ '
             + '【' + escHtml(reportTypeText || '退') + '】'
             + ' ×' + (it.return_qty || 0);
        if (returnStatusText) {
          html += '（退貨狀態：' + escHtml(returnStatusText) + '）';
        }
        if (it.return_reason) html += '｜原因：' + escHtml(it.return_reason);
        html += '</span>';
        if (it.admin_response) {
          html += '<br/><span class="admin-note">admin 回應：' + escHtml(it.admin_response) + '</span>';
        }
      }
      html += '</td>';
      html += '<td class="r">' + (it.qty || 0) + '</td>';
      html += '<td class="r">$' + (Number(it.unit_price) || 0).toLocaleString() + '</td>';
      html += '<td class="r">' + subtotalStr + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
  }

  html += '<div class="modal-actions">';
  if (isLegacy) {
    html += '<button class="btn-disabled" disabled title="📜 歷史單暫不支援列印">🔒 歷史單暫不支援列印</button>';
  } else if (isDraft) {
    html += '<button class="btn-disabled" disabled title="暫存單不可列印">🚫 暫存單不可列印</button>';
  } else {
    html += '<button class="btn-primary" id="btn-print-this">📄 列印此單</button>';
  }
  html += '<button class="btn-secondary" id="btn-close-modal-bottom">✕ 關閉</button>';
  html += '</div>';

  const body = document.getElementById('modal-body');
  body.innerHTML = html;
  body.querySelector('#btn-close-modal-bottom').addEventListener('click', closeDetailModal);
  const btnPrint = body.querySelector('#btn-print-this');
  if (btnPrint && !isDraft && !isLegacy) {
    btnPrint.addEventListener('click', function () {
      const url = 'print.html?orders=' + encodeURIComponent(o.order_no);
      window.open(url, '_blank');
    });
  }
}


// ============================================================
// 工具：舊系統英文值翻譯（給 legacy modal 用，跟店家 Sheet 同邏輯）
// ============================================================

function translateReportType(t) {
  const s = String(t || '').toLowerCase();
  if (s === 'return')                    return '退';
  if (s === 'shortage' || s === 'short') return '少';
  if (s === 'damaged'  || s === 'damage')return '損';
  if (s === 'missing')                   return '缺';
  return t || '';
}

function translateReturnStatus(s) {
  const x = String(s || '').toLowerCase();
  if (x === 'requested') return '申請中';
  if (x === 'accepted')  return '已同意';
  if (x === 'received')  return '已收到';
  if (x === 'rejected')  return '已拒絕';
  if (x === 'waived')    return '免退';
  if (x === 'none' || x === 'null' || x === '') return '';
  return s || '';
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

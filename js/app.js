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
// 月結報表
// ============================================================

let _lastReportRows = [];   // 給 Excel 匯出用
let _lastReportMonth = '';  // 'YYYY-MM'

function toggleMainView(viewName) {
  // 'orders' / 'report' / 'detail'
  const ordersView = document.getElementById('orders-view');
  const reportView = document.getElementById('report-view');
  const detailView = document.getElementById('store-detail-view');
  const btn = document.getElementById('btn-toggle-report');

  ordersView.style.display = 'none';
  reportView.style.display = 'none';
  detailView.style.display = 'none';

  if (viewName === 'report') {
    reportView.style.display = '';
    btn.textContent = '📋 訂單列表';
    if (!document.getElementById('report-month').options.length) {
      populateMonthSelect();
    }
    if (!_lastReportMonth) {
      loadMonthlyReport();
    }
  } else if (viewName === 'detail') {
    detailView.style.display = '';
    btn.textContent = '📋 訂單列表';
  } else {
    ordersView.style.display = '';
    btn.textContent = '📊 月結報表';
  }
}

function populateMonthSelect() {
  const sel = document.getElementById('report-month');
  // 從 2026-04 到當月
  const start = { y: 2026, m: 4 };
  const today = new Date();
  const end = { y: today.getFullYear(), m: today.getMonth() + 1 };

  const months = [];
  let y = start.y, m = start.m;
  while (y < end.y || (y === end.y && m <= end.m)) {
    months.push(y + '-' + pad2(m));
    m++;
    if (m > 12) { m = 1; y++; }
  }

  // 倒序：新到舊
  months.reverse();
  sel.innerHTML = '';
  for (let i = 0; i < months.length; i++) {
    const opt = document.createElement('option');
    opt.value = months[i];
    opt.textContent = months[i];
    sel.appendChild(opt);
  }
  // 預設當月
  sel.value = months[0];
}

async function loadMonthlyReport() {
  const sel = document.getElementById('report-month');
  const yearMonth = sel.value;
  if (!yearMonth) return;

  const tbody = document.getElementById('report-tbody');
  const tfoot = document.getElementById('report-tfoot');
  const statusEl = document.getElementById('report-status');
  const btnExcel = document.getElementById('btn-report-excel');

  tbody.innerHTML = '<tr><td colspan="6" class="empty">⏳ 載入中...</td></tr>';
  tfoot.style.display = 'none';
  btnExcel.style.display = 'none';
  _lastReportRows = [];

  statusEl.className = 'status-bar status-info';
  statusEl.textContent = '查詢 ' + yearMonth + '...';
  statusEl.style.display = '';

  try {
    const rows = await ltGetMonthlySummary(yearMonth);
    // race guard：admin 快速切月份時，較慢回來的舊請求不該覆蓋畫面
    if (document.getElementById('report-month').value !== yearMonth) return;
    _lastReportRows = Array.isArray(rows) ? rows : [];
    _lastReportMonth = yearMonth;
    renderReportTable(_lastReportRows);
    statusEl.className = 'status-bar status-success';
    statusEl.textContent = '✅ ' + yearMonth + ' 月結 — 共 ' + _lastReportRows.length + ' 家店';
    btnExcel.style.display = '';
  } catch (err) {
    // 同樣的 race guard：err 是慢回來的也不該蓋掉現在的畫面
    if (document.getElementById('report-month').value !== yearMonth) return;
    tbody.innerHTML = '<tr><td colspan="6" class="empty">查詢失敗</td></tr>';
    statusEl.className = 'status-bar status-error';
    statusEl.textContent = '❌ 查詢失敗：' + err.message;
  }
}

function renderReportTable(rows) {
  const tbody = document.getElementById('report-tbody');
  const tfoot = document.getElementById('report-tfoot');

  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">無資料</td></tr>';
    tfoot.style.display = 'none';
    return;
  }

  let html = '';
  let totSales = 0, totReturns = 0, totFee = 0, totTransfer = 0;
  let totSalesCnt = 0, totReturnsCnt = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const sales = Number(r.sales_amount) || 0;
    const returns = Number(r.returns_amount) || 0;
    const fee = Number(r.monthly_fee) || 0;
    const transfer = Number(r.transfer_net) || 0;
    const net = Number(r.net_amount) || 0;
    const salesCnt = Number(r.sales_count) || 0;
    const returnsCnt = Number(r.returns_count) || 0;

    totSales += sales;
    totReturns += returns;
    totFee += fee;
    totTransfer += transfer;
    totSalesCnt += salesCnt;
    totReturnsCnt += returnsCnt;

    const returnsCls = returns > 0 ? ' class="negative"' : '';
    const netCls = net < 0 ? ' class="negative"' : '';
    const netStr = net < 0
      ? '-$' + Math.abs(net).toLocaleString()
      : '$' + net.toLocaleString();

    html += '<tr>';
    html += '<td><a class="store-link" data-store="' + escAttr(r.store_name) + '">'
         + escHtml(r.store_name) + '</a></td>';
    html += '<td class="r">' + salesCnt + '</td>';
    html += '<td class="r">$' + sales.toLocaleString() + '</td>';
    html += '<td class="r">' + returnsCnt + '</td>';
    html += '<td class="r"' + returnsCls + '>'
         + (returns > 0 ? '-$' + returns.toLocaleString() : '$0')
         + '</td>';
    // 月費欄：可編輯 input + 💾
    html += '<td class="r">'
         + '<input type="number" class="fee-input" data-store="' + escAttr(r.store_name) + '" '
         + 'value="' + fee + '" min="0" step="100" />'
         + '<button type="button" class="btn-fee-save" data-store="' + escAttr(r.store_name) + '" title="儲存">💾</button>'
         + '</td>';
    // 店轉店淨額：v1 固定 0 灰字
    html += '<td class="r"><span class="placeholder-cell" title="任務 6 完成後接入">$0</span></td>';
    html += '<td class="r"' + netCls + '><b>' + netStr + '</b></td>';
    html += '</tr>';
  }
  tbody.innerHTML = html;

  // 合計
  const totNet = totSales - totReturns + totFee + totTransfer;
  document.getElementById('total-sales-cnt').textContent = totSalesCnt;
  document.getElementById('total-sales').textContent = '$' + totSales.toLocaleString();
  document.getElementById('total-returns-cnt').textContent = totReturnsCnt;
  document.getElementById('total-returns').textContent = totReturns > 0
    ? '-$' + totReturns.toLocaleString()
    : '$0';
  document.getElementById('total-fee').textContent = '$' + totFee.toLocaleString();
  document.getElementById('total-transfer').textContent = '$' + totTransfer.toLocaleString();
  document.getElementById('total-net').textContent = totNet < 0
    ? '-$' + Math.abs(totNet).toLocaleString()
    : '$' + totNet.toLocaleString();
  tfoot.style.display = '';

  // 綁事件：店名點擊進明細 / 月費編輯
  const storeLinks = tbody.querySelectorAll('.store-link');
  for (let i = 0; i < storeLinks.length; i++) {
    storeLinks[i].addEventListener('click', function () {
      openStoreDetail(this.dataset.store);
    });
  }
  const feeInputs = tbody.querySelectorAll('.fee-input');
  for (let i = 0; i < feeInputs.length; i++) {
    feeInputs[i].addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveFee(this.dataset.store, this.value); }
    });
    feeInputs[i].addEventListener('blur', function () {
      // blur 不自動存（避免 click 💾 同時觸發）
    });
  }
  const saveBtns = tbody.querySelectorAll('.btn-fee-save');
  for (let i = 0; i < saveBtns.length; i++) {
    saveBtns[i].addEventListener('click', function () {
      const store = this.dataset.store;
      const input = tbody.querySelector('.fee-input[data-store="' + store + '"]');
      saveFee(store, input.value);
    });
  }
}

async function saveFee(storeName, feeValue) {
  const fee = Number(feeValue);
  if (isNaN(fee) || fee < 0) {
    alert('月費必須是 0 以上的數字');
    return;
  }
  const statusEl = document.getElementById('report-status');
  statusEl.className = 'status-bar status-info';
  statusEl.textContent = '儲存 ' + storeName + ' 月費：$' + fee + '...';
  statusEl.style.display = '';
  try {
    await ltUpdateStoreMonthlyFee(storeName, fee);
    statusEl.className = 'status-bar status-success';
    statusEl.textContent = '✅ ' + storeName + ' 月費已存為 $' + fee + '，重新整理彙總表...';
    // 重新 load 報表（淨應收會跟著重算）
    await loadMonthlyReport();
  } catch (err) {
    statusEl.className = 'status-bar status-error';
    statusEl.textContent = '❌ 儲存失敗：' + err.message;
  }
}


// ============================================================
// 店家明細頁
// ============================================================

let _lastDetailRows = [];
let _lastDetailStore = '';
let _lastDetailMonth = '';
let _lastDetailFee = 0;
let _lastDetailTransfer = 0;

async function openStoreDetail(storeName) {
  _lastDetailStore = storeName;
  _lastDetailMonth = _lastReportMonth;
  document.getElementById('detail-title').textContent =
    storeName + '  ｜  ' + _lastReportMonth;
  toggleMainView('detail');

  const tbody = document.getElementById('detail-tbody');
  const tfoot = document.getElementById('detail-tfoot');
  const statusEl = document.getElementById('detail-status');
  tbody.innerHTML = '<tr><td colspan="7" class="empty">⏳ 載入中...</td></tr>';
  tfoot.style.display = 'none';
  statusEl.className = 'status-bar status-info';
  statusEl.textContent = '查詢 ' + storeName + ' ' + _lastReportMonth + ' 明細...';
  statusEl.style.display = '';

  // 從彙總列拿月費 / 店轉店（避免再 fetch）
  const summaryRow = (_lastReportRows || []).find(r => r.store_name === storeName) || {};
  _lastDetailFee = Number(summaryRow.monthly_fee) || 0;
  _lastDetailTransfer = Number(summaryRow.transfer_net) || 0;

  try {
    const rows = await ltGetStoreMonthlyDetail(storeName, _lastReportMonth);
    // race guard
    if (_lastDetailStore !== storeName || _lastDetailMonth !== _lastReportMonth) return;
    _lastDetailRows = Array.isArray(rows) ? rows : [];
    renderDetailTable();
    statusEl.className = 'status-bar status-success';
    statusEl.textContent = '✅ ' + storeName + ' ' + _lastReportMonth + ' 明細 — 共 ' + _lastDetailRows.length + ' 筆';
  } catch (err) {
    if (_lastDetailStore !== storeName || _lastDetailMonth !== _lastReportMonth) return;
    tbody.innerHTML = '<tr><td colspan="7" class="empty">查詢失敗</td></tr>';
    statusEl.className = 'status-bar status-error';
    statusEl.textContent = '❌ ' + err.message;
  }
}

function renderDetailTable() {
  const tbody = document.getElementById('detail-tbody');
  const tfoot = document.getElementById('detail-tfoot');
  const rows = _lastDetailRows;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">該店該月無資料</td></tr>';
    // 仍顯示 footer（可能只有月費）
  }

  let html = '';
  let subQty = 0, subSales = 0, subReturns = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const qty = Number(r.total_qty) || 0;
    const sales = Number(r.sales_amount) || 0;
    const returns = Number(r.returns_amount) || 0;
    const net = Number(r.net_amount) || 0;
    subQty += qty;
    subSales += sales;
    subReturns += returns;

    const dataType = r.data_type || 'simple';
    let typeBadge = '';
    if (dataType === 'simple')              typeBadge = '<span class="badge b-simple">📦 一般</span>';
    else if (dataType === 'legacy_normal')  typeBadge = '<span class="badge b-legacy">📜 歷史</span>';
    else                                    typeBadge = '<span class="badge b-legacy-return">📜 歷史退貨</span>';

    const returnsCls = returns > 0 ? ' class="r negative"' : ' class="r"';
    const netCls = net < 0 ? ' class="r negative"' : ' class="r"';
    const netStr = net < 0
      ? '-$' + Math.abs(net).toLocaleString()
      : '$' + net.toLocaleString();

    html += '<tr>';
    html += '<td>' + (r.order_date || '-') + '</td>';
    html += '<td class="mono">' + escHtml(r.order_no) + '</td>';
    html += '<td>' + typeBadge + '</td>';
    html += '<td class="r">' + qty + '</td>';
    html += '<td class="r">' + (sales > 0 ? '$' + sales.toLocaleString() : '-') + '</td>';
    html += '<td' + returnsCls + '>' + (returns > 0 ? '-$' + returns.toLocaleString() : '-') + '</td>';
    html += '<td' + netCls + '><b>' + netStr + '</b></td>';
    html += '</tr>';
  }
  if (rows.length > 0) tbody.innerHTML = html;

  // 小計 + 月費 + 店轉店 + 應收
  const subNet = subSales - subReturns;
  const grandNet = subNet + _lastDetailFee + _lastDetailTransfer;
  document.getElementById('detail-sub-qty').textContent = subQty;
  document.getElementById('detail-sub-sales').textContent = '$' + subSales.toLocaleString();
  document.getElementById('detail-sub-returns').textContent = subReturns > 0
    ? '-$' + subReturns.toLocaleString()
    : '$0';
  document.getElementById('detail-sub-net').textContent = subNet < 0
    ? '-$' + Math.abs(subNet).toLocaleString()
    : '$' + subNet.toLocaleString();
  document.getElementById('detail-fee').textContent = '$' + _lastDetailFee.toLocaleString();
  document.getElementById('detail-transfer').textContent = '$' + _lastDetailTransfer.toLocaleString();
  document.getElementById('detail-grand-net').textContent = grandNet < 0
    ? '-$' + Math.abs(grandNet).toLocaleString()
    : '$' + grandNet.toLocaleString();
  tfoot.style.display = '';
}

function exportDetailExcel() {
  if (!_lastDetailRows || !_lastDetailStore) {
    alert('沒有資料可匯出');
    return;
  }
  if (typeof XLSX === 'undefined') {
    alert('XLSX library 未載入，請重整頁面再試');
    return;
  }

  const rows = [];
  let subQty = 0, subSales = 0, subReturns = 0;
  for (let i = 0; i < _lastDetailRows.length; i++) {
    const r = _lastDetailRows[i];
    const qty = Number(r.total_qty) || 0;
    const sales = Number(r.sales_amount) || 0;
    const returns = Number(r.returns_amount) || 0;
    const net = Number(r.net_amount) || 0;
    subQty += qty;
    subSales += sales;
    subReturns += returns;

    let typeText = '一般';
    if (r.data_type === 'legacy_normal')      typeText = '歷史';
    else if (r.data_type === 'legacy_return') typeText = '歷史退貨';

    rows.push({
      '日期':     r.order_date || '',
      '單號':     r.order_no || '',
      '類型':     typeText,
      '件數':     qty,
      '銷貨金額': sales,
      '退貨金額': returns,
      '淨額':     net
    });
  }
  // 小計、月費、店轉店、應收
  rows.push({ '日期': '【明細小計】', '單號': '', '類型': '', '件數': subQty, '銷貨金額': subSales, '退貨金額': subReturns, '淨額': subSales - subReturns });
  rows.push({ '日期': '＋月費',        '單號': '', '類型': '', '件數': '',     '銷貨金額': '',       '退貨金額': '',          '淨額': _lastDetailFee });
  rows.push({ '日期': '＋店轉店淨額',  '單號': '', '類型': '', '件數': '',     '銷貨金額': '',       '退貨金額': '',          '淨額': _lastDetailTransfer });
  rows.push({ '日期': '【本月應收】',  '單號': '', '類型': '', '件數': '',     '銷貨金額': '',       '退貨金額': '',          '淨額': (subSales - subReturns) + _lastDetailFee + _lastDetailTransfer });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 }, { wch: 18 }, { wch: 10 },
    { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }
  ];
  // 單號欄文字格式
  for (let r = 2; r <= rows.length + 1; r++) {
    const cellB = ws['B' + r];
    if (cellB) { cellB.t = 's'; cellB.z = '@'; }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, _lastDetailStore + ' ' + _lastDetailMonth);

  const filename = '月結_' + _lastDetailStore + '_' + _lastDetailMonth + '.xlsx';
  XLSX.writeFile(wb, filename);
}

function printStoreDetail() {
  if (!_lastDetailRows || !_lastDetailStore) {
    alert('沒有資料可列印');
    return;
  }

  const rows = _lastDetailRows;
  let subQty = 0, subSales = 0, subReturns = 0;
  let bodyHtml = '';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const qty = Number(r.total_qty) || 0;
    const sales = Number(r.sales_amount) || 0;
    const returns = Number(r.returns_amount) || 0;
    const net = Number(r.net_amount) || 0;
    subQty += qty;
    subSales += sales;
    subReturns += returns;

    let typeText = '一般';
    if (r.data_type === 'legacy_normal')      typeText = '歷史';
    else if (r.data_type === 'legacy_return') typeText = '歷史退貨';

    bodyHtml += '<tr>';
    bodyHtml += '<td>' + (r.order_date || '-') + '</td>';
    bodyHtml += '<td class="mono">' + escHtml(r.order_no) + '</td>';
    bodyHtml += '<td>' + typeText + '</td>';
    bodyHtml += '<td class="r">' + qty + '</td>';
    bodyHtml += '<td class="r">' + (sales > 0 ? '$' + sales.toLocaleString() : '-') + '</td>';
    bodyHtml += '<td class="r' + (returns > 0 ? ' negative' : '') + '">' + (returns > 0 ? '-$' + returns.toLocaleString() : '-') + '</td>';
    bodyHtml += '<td class="r' + (net < 0 ? ' negative' : '') + '"><b>' + (net < 0 ? '-$' + Math.abs(net).toLocaleString() : '$' + net.toLocaleString()) + '</b></td>';
    bodyHtml += '</tr>';
  }

  const subNet = subSales - subReturns;
  const grandNet = subNet + _lastDetailFee + _lastDetailTransfer;
  const html = ''
    + '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'
    + _lastDetailStore + ' ' + _lastDetailMonth + ' 月結對帳單</title>'
    + '<style>'
    + '@page { size: A4; margin: 10mm; }'
    + 'body { font-family: "Microsoft JhengHei",sans-serif; font-size: 12px; color: #333; }'
    + 'h1 { font-size: 20px; text-align: center; margin: 0; }'
    + '.subtitle { text-align: center; font-size: 13px; color: #666; margin: 4px 0 16px; letter-spacing: 4px; }'
    + 'table { width: 100%; border-collapse: collapse; }'
    + 'th, td { border: 1px solid #999; padding: 6px 8px; }'
    + 'th { background: #eee; }'
    + '.r { text-align: right; }'
    + '.mono { font-family: Consolas, monospace; }'
    + '.negative { color: #c00; font-weight: bold; }'
    + '.subtotal-row th { background: #f5f5f5; }'
    + '.addon-row th { background: #fafafa; font-weight: normal; }'
    + '.total-row th { background: #fff3e0; color: #b53400; font-size: 14px; }'
    + '.print-actions { position: fixed; top: 8px; right: 8px; }'
    + '.print-actions button { padding: 6px 14px; font-size: 13px; cursor: pointer; }'
    + '@media print { .print-actions { display: none; } }'
    + '</style></head><body>'
    + '<div class="print-actions"><button onclick="window.print()">🖨️ 列印</button> <button onclick="window.close()">✕ 關閉</button></div>'
    + '<h1>丸十水產股份有限公司</h1>'
    + '<div class="subtitle">' + _lastDetailStore + ' ' + _lastDetailMonth + ' 月結對帳單</div>'
    + '<table>'
    +   '<thead><tr>'
    +     '<th>日期</th><th>單號</th><th>類型</th>'
    +     '<th class="r">件數</th><th class="r">銷貨金額</th><th class="r">退貨金額</th><th class="r">淨額</th>'
    +   '</tr></thead>'
    +   '<tbody>' + (bodyHtml || '<tr><td colspan="7" style="text-align:center;color:#999;">無資料</td></tr>') + '</tbody>'
    +   '<tfoot>'
    +     '<tr class="subtotal-row"><th colspan="3">明細小計</th>'
    +       '<th class="r">' + subQty + '</th>'
    +       '<th class="r">$' + subSales.toLocaleString() + '</th>'
    +       '<th class="r' + (subReturns > 0 ? ' negative' : '') + '">' + (subReturns > 0 ? '-$' + subReturns.toLocaleString() : '$0') + '</th>'
    +       '<th class="r">' + (subNet < 0 ? '-$' + Math.abs(subNet).toLocaleString() : '$' + subNet.toLocaleString()) + '</th>'
    +     '</tr>'
    +     '<tr class="addon-row"><th colspan="6">＋ 月費</th><th class="r">$' + _lastDetailFee.toLocaleString() + '</th></tr>'
    +     '<tr class="addon-row"><th colspan="6">＋ 店轉店淨額（v2 接入）</th><th class="r">$' + _lastDetailTransfer.toLocaleString() + '</th></tr>'
    +     '<tr class="total-row"><th colspan="6">本月應收</th>'
    +       '<th class="r">' + (grandNet < 0 ? '-$' + Math.abs(grandNet).toLocaleString() : '$' + grandNet.toLocaleString()) + '</th>'
    +     '</tr>'
    +   '</tfoot>'
    + '</table>'
    + '<p style="margin-top:24px;font-size:11px;color:#666;">列印時間：' + new Date().toLocaleString('zh-TW') + '</p>'
    + '</body></html>';

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

function exportReportExcel() {
  if (!_lastReportRows || _lastReportRows.length === 0) {
    alert('沒有資料可匯出');
    return;
  }
  if (typeof XLSX === 'undefined') {
    alert('XLSX library 未載入，請重整頁面再試');
    return;
  }

  const rows = [];
  let totSales = 0, totReturns = 0, totFee = 0, totTransfer = 0;
  let totSalesCnt = 0, totReturnsCnt = 0;
  for (let i = 0; i < _lastReportRows.length; i++) {
    const r = _lastReportRows[i];
    const sales = Number(r.sales_amount) || 0;
    const returns = Number(r.returns_amount) || 0;
    const fee = Number(r.monthly_fee) || 0;
    const transfer = Number(r.transfer_net) || 0;
    const net = Number(r.net_amount) || 0;
    const salesCnt = Number(r.sales_count) || 0;
    const returnsCnt = Number(r.returns_count) || 0;
    totSales += sales;
    totReturns += returns;
    totFee += fee;
    totTransfer += transfer;
    totSalesCnt += salesCnt;
    totReturnsCnt += returnsCnt;
    rows.push({
      '店家':         r.store_name || '',
      '銷貨筆數':     salesCnt,
      '銷貨金額':     sales,
      '退貨筆數':     returnsCnt,
      '退貨金額':     returns,
      '月費':         fee,
      '店轉店淨額':   transfer,
      '本月應收':     net
    });
  }
  // 合計列
  rows.push({
    '店家':         '【合計】',
    '銷貨筆數':     totSalesCnt,
    '銷貨金額':     totSales,
    '退貨筆數':     totReturnsCnt,
    '退貨金額':     totReturns,
    '月費':         totFee,
    '店轉店淨額':   totTransfer,
    '本月應收':     totSales - totReturns + totFee + totTransfer
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 14 },
    { wch: 10 }, { wch: 12 }, { wch: 14 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, _lastReportMonth + ' 月結');

  const filename = '月結報表_' + _lastReportMonth + '.xlsx';
  XLSX.writeFile(wb, filename);
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

  // 月結報表切換按鈕
  document.getElementById('btn-toggle-report').addEventListener('click', function () {
    const reportView = document.getElementById('report-view');
    const isReport = reportView.style.display !== 'none';
    toggleMainView(isReport ? 'orders' : 'report');
  });
  // 月結報表 — 月份 / 查詢 / Excel
  document.getElementById('btn-report-refresh').addEventListener('click', loadMonthlyReport);
  document.getElementById('report-month').addEventListener('change', loadMonthlyReport);
  document.getElementById('btn-report-excel').addEventListener('click', exportReportExcel);
  // 店家明細 — 返回 / 列印 / Excel
  document.getElementById('btn-detail-back').addEventListener('click', function () {
    toggleMainView('report');
  });
  document.getElementById('btn-detail-print').addEventListener('click', printStoreDetail);
  document.getElementById('btn-detail-excel').addEventListener('click', exportDetailExcel);
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

// ============================================================
// LT-ERP 簡易銷貨單 — 列印頁邏輯
// ============================================================
// URL pattern: print.html?orders=SS-XXX,SS-YYY,...
// 流程：
//   1. 取 query string 解析 order_no 陣列
//   2. 確認 session（沒登入 redirect 回 index.html）
//   3. 呼叫 simple_get_orders_details_batch RPC
//   4. 渲染每張單一個 .print-page
//   5. 載入完 1 秒後自動 window.print()
// ============================================================

function parseOrders() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('orders') || '';
  return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

function setStatus(msg) {
  document.getElementById('status').textContent = msg || '';
}

function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function statusClass(s) {
  if (s === '待處理') return 's-pending';
  if (s === '已建單') return 's-issued';
  if (s === '已收到') return 's-received';
  if (s === '有問題') return 's-issue';
  return 's-issued';
}

function renderPage(entry) {
  // entry: { order, items } | { order_no, missing: true } | { order_no, draft_blocked: true, message }
  if (entry.missing) {
    return '<div class="print-page missing">'
         + '⚠️ 找不到單號：' + escHtml(entry.order_no)
         + '</div>';
  }

  // ⚡ 任務 4.1 A 段：暫存單在 RPC 端就被擋（draft_blocked: true）
  if (entry.draft_blocked) {
    return '<div class="print-page missing" style="background:#fff8e1;color:#bf360c;border:2px solid #ffa000;">'
         + '📝 暫存單不可列印：' + escHtml(entry.order_no) + '<br/>'
         + '<small style="margin-top:6px;display:block;color:#6d4c41;">'
         + escHtml(entry.message || '請先到 16staff Sheet 暫存銷貨單分頁按「✅ 一鍵確認所有暫存單」轉正式後再列印')
         + '</small>'
         + '</div>';
  }

  const o = entry.order || {};
  const items = entry.items || [];
  let html = '<div class="print-page">';

  // 標頭（簡化版：只留公司名，副標拿掉）
  html += '<div class="print-header">';
  html += '<div class="company">丸十水產股份有限公司</div>';
  html += '</div>';

  // 主要欄位
  html += '<div class="print-info">';
  html += '<div class="row"><span class="label">單號：</span><span class="order-no">' + escHtml(o.order_no) + '</span></div>';
  html += '<div class="row"><span class="label">店家：</span><span>' + escHtml(o.store_name) + '</span></div>';
  html += '<div class="row"><span class="label">訂單日：</span><span>' + (o.order_date || '-') + '</span></div>';
  html += '<div class="row"><span class="label">出貨日：</span><span>' + (o.delivery_date || '-') + '</span></div>';
  html += '</div>';

  // 狀態
  html += '<div class="print-status-row">';
  html += '<span class="status-tag ' + statusClass(o.status) + '">' + escHtml(o.status) + '</span>';
  if (o.has_return) {
    html += '<span class="status-tag s-issue">⚠️ 退貨：' + escHtml(o.return_status) + '</span>';
  }
  if (o.received_at) {
    html += '<span style="color:#2e7d32;">✅ 收貨：' + formatTs(o.received_at) + '</span>';
  }
  html += '</div>';

  // 明細
  html += '<table class="print-table">';
  html += '<thead><tr>';
  html += '<th style="width:90px;">編號</th>';
  html += '<th>商品名稱</th>';
  html += '<th class="r" style="width:50px;">數量</th>';
  html += '<th class="r" style="width:60px;">單價</th>';
  html += '<th class="r" style="width:70px;">小計</th>';
  html += '</tr></thead>';
  html += '<tbody>';

  let totalQty = 0, totalAmount = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    totalQty    += (it.qty || 0);
    totalAmount += Number(it.subtotal) || 0;
    html += '<tr>';
    html += '<td class="pid">' + escHtml(it.product_id) + '</td>';
    html += '<td>' + escHtml(it.product_name) + '</td>';
    html += '<td class="r">' + (it.qty || 0) + '</td>';
    html += '<td class="r">$' + (Number(it.unit_price) || 0).toLocaleString() + '</td>';
    html += '<td class="r">$' + (Number(it.subtotal) || 0).toLocaleString() + '</td>';
    html += '</tr>';
  }
  html += '</tbody>';
  html += '<tfoot><tr>';
  html += '<td></td>';
  html += '<td class="r">合計</td>';
  html += '<td class="r">' + totalQty + ' 件</td>';
  html += '<td></td>';
  html += '<td class="r">$' + totalAmount.toLocaleString() + '</td>';
  html += '</tr></tfoot>';
  html += '</table>';

  // 退貨提醒（頁尾小字）
  const returnedItems = items.filter(it => it.return_status && it.return_status !== '無');
  if (returnedItems.length > 0) {
    html += '<div class="print-return-warn">';
    html += '<strong>⚠️ 此單有退貨：</strong>';
    for (let i = 0; i < returnedItems.length; i++) {
      const it = returnedItems[i];
      html += '<div class="item">'
           + escHtml(it.product_name) + '：'
           + escHtml(it.report_type || '?') + ' ×' + (it.return_qty || 0)
           + '，狀態：' + escHtml(it.return_status);
      html += '</div>';
    }
    html += '</div>';
  }

  // 頁尾（簡化版：只留撿貨員 + 建單時間，簽名區拿掉）
  html += '<div class="print-footer">';
  html += '<div>撿貨員：' + escHtml(o.picker_email || '-') + '　／　建單時間：' + (o.created_at ? formatTs(o.created_at) : '-') + '</div>';
  html += '</div>';

  html += '</div>';
  return html;
}

function formatTs(ts) {
  try {
    const d = new Date(ts);
    const pad = n => n < 10 ? '0' + n : '' + n;
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
         + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  } catch (e) { return ts; }
}

async function init() {
  const orderNos = parseOrders();

  if (orderNos.length === 0) {
    document.getElementById('loading').innerHTML =
      '<div class="loader-text" style="color:#c62828;">❌ 沒有指定單號（URL 缺 ?orders=...）</div>';
    return;
  }

  setStatus('共 ' + orderNos.length + ' 張單');

  // 確認登入
  const user = await ltGetUser();
  if (!user || LT_CONFIG.ALLOWED_ROLES.indexOf(user.role) < 0) {
    // 沒登入或 role 不對 → 回主頁
    alert('請先登入 admin 帳號');
    window.location.href = 'index.html';
    return;
  }

  // 拉資料
  let result;
  try {
    result = await ltGetOrdersBatch(orderNos);
  } catch (err) {
    document.getElementById('loading').innerHTML =
      '<div class="loader-text" style="color:#c62828;">❌ 載入失敗：' + escHtml(err.message) + '</div>';
    return;
  }

  if (!Array.isArray(result) || result.length === 0) {
    document.getElementById('loading').innerHTML =
      '<div class="loader-text">無資料</div>';
    return;
  }

  // 渲染
  let html = '';
  for (let i = 0; i < result.length; i++) {
    html += renderPage(result[i]);
  }
  document.getElementById('print-area').innerHTML = html;
  document.getElementById('loading').style.display = 'none';

  setStatus('共 ' + result.length + ' 張單，1 秒後自動列印...');

  // 1 秒後自動 print（讓 user 來得及看一眼）
  setTimeout(function () {
    setStatus('共 ' + result.length + ' 張單');
    window.print();
  }, 1000);
}


// 註冊按鈕
document.getElementById('btn-print').addEventListener('click', function () {
  window.print();
});
document.getElementById('btn-back').addEventListener('click', function () {
  window.location.href = 'index.html';
});


// 啟動
init();

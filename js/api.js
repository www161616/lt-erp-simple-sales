// ============================================================
// LT-ERP 簡易銷貨單 — RPC 包裝
// ============================================================
// 用 supabase-js 的 sb.rpc()，會自動帶 JWT (Authorization: Bearer)
// 後端 RPC 用「admin_secret OR JWT role」二擇一驗證 — 前端只走 JWT 路徑
// ============================================================
// B 段：先放通用包裝，C 段補列表 / 明細 / 批次 wrappers
// ============================================================

window.ltCallRpc = async function (funcName, params) {
  const { data, error } = await sb.rpc(funcName, params || {});
  if (error) {
    // PostgREST 回的錯誤包在 error.message
    throw new Error(error.message || ('RPC ' + funcName + ' 失敗'));
  }
  return data;
};


// ============================================================
// C 段：訂單列表 + 單張明細
// ============================================================

// 取訂單列表（filters 為 {from, to, store, status, returnStatus, search, limit}）
window.ltGetAllOrders = async function (filters) {
  filters = filters || {};
  return await ltCallRpc('simple_get_all_orders', {
    p_admin_secret:  null,             // 前端走 JWT
    p_delivery_from: filters.from         || null,
    p_delivery_to:   filters.to           || null,
    p_store_name:    filters.store        || null,
    p_status:        filters.status       || null,
    p_return_status: filters.returnStatus || null,
    p_search:        filters.search       || null,
    p_limit:         filters.limit        || 500
  });
};


// 取單張訂單明細，回傳 { order, items }
window.ltGetOrderDetails = async function (orderNo) {
  return await ltCallRpc('simple_get_order_details_admin', {
    p_admin_secret: null,
    p_order_no:     orderNo
  });
};


// 批次取多張單明細（給列印頁用）
//   回傳 array：[ {order, items} | {order_no, missing:true} | {order_no, draft_blocked:true, message} ]
//   後端 simple_get_orders_details_batch 一次最多 100 筆，A 段已擋暫存單
window.ltGetOrdersBatch = async function (orderNos) {
  if (!Array.isArray(orderNos) || orderNos.length === 0) {
    throw new Error('orderNos 必須是非空陣列');
  }
  if (orderNos.length > 100) {
    throw new Error('一次最多 100 張單，請分批列印');
  }
  return await ltCallRpc('simple_get_orders_details_batch', {
    p_admin_secret: null,
    p_order_nos:    orderNos
  });
};


// ============================================================
// 舊系統 admin 版（4/22 之前的銷貨單 + 退貨單）
// ============================================================

// 取舊單列表（filters 為 {from, to, store, orderType, search, limit}）
//   orderType: 'normal' | 'return' | null（全部）
window.ltGetLegacyAllOrders = async function (filters) {
  filters = filters || {};
  return await ltCallRpc('get_legacy_all_orders_admin', {
    p_admin_secret: null,
    p_date_from:    filters.from       || null,
    p_date_to:      filters.to         || null,
    p_store_name:   filters.store      || null,
    p_order_type:   filters.orderType  || null,
    p_search:       filters.search     || null,
    p_limit:        filters.limit      || 500
  });
};


// 取舊單明細（SO/RT 共用）
window.ltGetLegacyOrderDetails = async function (orderNo) {
  return await ltCallRpc('get_legacy_order_details_admin', {
    p_admin_secret: null,
    p_order_no:     orderNo
  });
};

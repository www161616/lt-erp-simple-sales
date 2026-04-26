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


// C 段會加：
// - ltGetAllOrders(filters)
// - ltGetOrderDetails(orderNo)
// - ltGetOrdersBatch(orderNos)

# LT-ERP 簡易銷貨單

獨立網站，給總倉撿貨員 / 助理 / admin 查詢列印 simple_sales_orders 銷貨單。

跟舊 lt-erp 完全切開，僅共用 Supabase DB（透過 simple_* 表 + admin 用 RPC）。

---

## 部署

### GitHub Pages

1. Repo → Settings → Pages
2. Source: `Deploy from a branch`
3. Branch: `main` / Folder: `/ (root)`
4. 等 1~2 分鐘 → 訪問 https://www161616.github.io/lt-erp-simple-sales/

### 本機測試

純靜態 HTML / JS，沒有 build step。

```
# 任何靜態 server 都可，例如：
python -m http.server 8000
# 或用 VSCode Live Server 擴充套件
```

訪問 http://localhost:8000

---

## 安全模型

- **登入**：Supabase Auth (email + password)，跟 lt-erp 同帳號
- **role 限制**：只允許 `user_metadata.role IN ('admin','assistant')`，其他 role 自動 signOut
- **RPC 驗證**：所有讀寫走 `simple_*` SECURITY DEFINER RPC
  - 後端二擇一驗證：`admin_secret` 或 JWT role
  - **前端只走 JWT 路徑**（admin_secret 不放這裡）
- **可放這個 Public Repo 的金鑰**：
  - ✅ Supabase URL（公開）
  - ✅ anon key（公開的 JWT，配合 RLS）
- **不可放**：
  - ❌ admin_secret（在 16staff Apps Script Script Properties）
  - ❌ store_secret（在各店 Sheet Script Properties）
  - ❌ service_role key

---

## 檔案結構

```
lt-erp-simple-sales/
├── index.html          ← SPA 入口（登入 + 主畫面）
├── README.md
├── css/
│   └── style.css
└── js/
    ├── config.js       ← Supabase URL + anon key
    ├── auth.js         ← Supabase Auth wrapper
    ├── api.js          ← RPC 呼叫包裝
    └── app.js          ← 主畫面 SPA 邏輯
```

---

## 進度

### ✅ B 段（登入機制）
- [x] Supabase Auth 登入
- [x] role 檢查（admin / assistant 才能進）
- [x] 自動 session restore（重整不用重登）
- [x] 登出 / JWT 過期自動回登入頁

### ⏳ C 段（列表 + 篩選）— 待做
- [ ] 訂單列表
- [ ] 快捷區間：今日 / 明日 / 7 天 / 30 天
- [ ] 篩選：店家、狀態、退貨狀態、單號搜尋
- [ ] 點單號開明細 modal

### ⏳ D 段（列印）— 待做
- [ ] 單張 A5 列印
- [ ] 批次列印今日 18 家
- [ ] 列印 CSS（@media print + page-break）

---

## 後端 RPC（DB 端已部署，不在 git）

- `simple_get_all_orders(p_admin_secret, p_delivery_from, p_delivery_to, p_store_name, p_status, p_return_status, p_search, p_limit)`
- `simple_get_order_details_admin(p_admin_secret, p_order_no)`
- `simple_get_orders_details_batch(p_admin_secret, p_order_nos[])`

migration SQL 在 lt-erp repo `docs/sql/migrations/2026-04-26_simple_admin_orders.sql`。

---

## 相關 Repo / 系統

- **lt-erp**（舊系統）：https://github.com/www161616/lt-erp
- **16staff Sheet**：撿貨員一鍵建單 + admin 退貨處理（Google Apps Script）
- **店家 Sheet**：每店一份，看進貨單 + 退貨申請（Google Apps Script）

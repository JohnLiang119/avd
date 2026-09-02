import { defineConfig } from 'vitest/config';

// 測試設定：本階段僅覆蓋 useTaskStore 的純邏輯，
// 不需要 jsdom 或 Tauri API mock，故使用預設的 node 環境。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.spec.ts'],
  },
});

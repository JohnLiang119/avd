<template>
  <!--
    鬧鐘選檔清單（OpenSpec live-radio-alarm design.md D19）：列出全手機的 mp3／mp4，
    預設日期新到舊，可搜尋與切換排序；勾選的先後就是加入順序（列上顯示序號）。
    複製進行中（busy）不可關閉、不可再改選取，避免使用者以為已取消而實際仍在寫入。
  -->
  <van-popup
    :show="show"
    position="bottom"
    round
    :closeable="!busy"
    :close-on-click-overlay="!busy"
    :style="{ height: '85vh', display: 'flex', flexDirection: 'column' }"
    @update:show="onShowUpdate"
  >
    <div class="mp-head">
      <div class="mp-title">{{ title }}</div>
      <div class="mp-sub">{{ subtitle }}</div>
      <van-field
        v-model="query"
        placeholder="搜尋檔名或資料夾"
        clearable
        :border="false"
        class="mp-search"
        :disabled="busy"
      />
      <div class="mp-sort">
        <span class="mp-sort-label">排序</span>
        <button
          v-for="opt in MEDIA_SORT_OPTIONS"
          :key="opt.key"
          type="button"
          class="mp-sort-btn"
          :class="{ active: sortKey === opt.key }"
          :disabled="busy"
          @click="sortKey = opt.key"
        >{{ opt.label }}</button>
      </div>
      <div v-if="permissionHint" class="mp-hint">
        {{ permissionHint }}
        <button type="button" class="mp-link" @click="openSettings">開啟設定</button>
      </div>
      <div v-if="list?.truncated" class="mp-hint">檔案太多，只列最新 {{ list.files.length }} 個；可用搜尋找較舊的</div>
    </div>

    <div class="mp-body">
      <div v-if="loading" class="mp-state"><van-loading size="22px" /><span>正在找手機裡的 mp3／mp4…</span></div>
      <div v-else-if="loadError" class="mp-state">
        <span>{{ loadError }}</span>
        <van-button size="small" plain class="mp-plain" @click="load(true)">重試</van-button>
      </div>
      <div v-else-if="!list?.files.length" class="mp-state">
        <span>手機裡找不到 mp3／mp4</span>
        <span class="mp-faint">檔案在雲端硬碟或其他位置時，請用下方的系統選檔器</span>
      </div>
      <div v-else-if="!filtered.length" class="mp-state"><span>沒有符合「{{ query.trim() }}」的檔案</span></div>
      <template v-else>
        <div
          v-for="item in visible"
          :key="item.uri"
          class="mp-row"
          :class="{ selected: orderOf(item.uri) > 0, disabled: busy }"
          role="checkbox"
          :aria-checked="orderOf(item.uri) > 0"
          @click="toggle(item.uri)"
        >
          <span class="mp-check" :class="{ on: orderOf(item.uri) > 0 }">{{ orderOf(item.uri) || '' }}</span>
          <div class="mp-info">
            <div class="mp-name">{{ item.displayName }}</div>
            <div class="mp-meta">
              <span class="mp-kind">{{ item.kind === 'video' ? 'MP4' : 'MP3' }}</span>
              <span>{{ describeMediaFolder(item.folder) }}</span>
              <span v-if="item.modifiedAt">· {{ formatMediaDate(item.modifiedAt, now) }}</span>
              <span v-if="item.sizeBytes">· {{ formatMediaSize(item.sizeBytes) }}</span>
              <span v-if="item.durationMs">· {{ formatMediaDuration(item.durationMs) }}</span>
            </div>
            <div v-if="existingSet.has(item.displayName)" class="mp-faint">此頻道已有同名檔案</div>
          </div>
        </div>
        <van-button
          v-if="visible.length < filtered.length"
          size="small" block plain class="mp-plain" style="margin: 8px 0 4px;"
          @click="renderLimit += MEDIA_PAGE_SIZE"
        >顯示更多（還有 {{ filtered.length - visible.length }} 個）</van-button>
      </template>
    </div>

    <div class="mp-foot">
      <van-button size="small" plain class="mp-plain" :disabled="busy" @click="emit('system-picker')">用系統選檔器</van-button>
      <van-button
        size="small"
        color="#0f172a"
        style="flex: 1;"
        :disabled="!selected.length"
        :loading="busy"
        loading-text="正在複製檔案…"
        @click="emit('confirm', [...selected])"
      >{{ selected.length ? `加入 ${selected.length} 個` : '請勾選檔案' }}</van-button>
    </div>
  </van-popup>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { App as CapApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { RadioAlarmService } from '../services/radioAlarm';
import {
  MEDIA_PAGE_SIZE,
  MEDIA_SORT_OPTIONS,
  describeMediaFolder,
  describeMediaPermission,
  filterMediaFiles,
  formatMediaDate,
  formatMediaDuration,
  formatMediaSize,
  sortMediaFiles,
  toggleMediaSelection,
  type DeviceMediaList,
  type MediaSortKey,
} from '../services/mediaPicker';

const props = defineProps<{
  show: boolean;
  title: string;
  /** 複製進行中 */
  busy: boolean;
  /** 目標頻道既有檔案的顯示名稱（加到既有頻道時提示同名）；新頻道為空 */
  existingNames?: readonly string[];
}>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  /** 依勾選順序的 MediaStore URI */
  (e: 'confirm', uris: string[]): void;
  (e: 'system-picker'): void;
}>();

const list = ref<DeviceMediaList | null>(null);
const loading = ref(false);
const loadError = ref('');
const query = ref('');
const sortKey = ref<MediaSortKey>('date');
const selected = ref<string[]>([]);
const renderLimit = ref(MEDIA_PAGE_SIZE);
const now = ref(new Date());
let loadSeq = 0;

const sorted = computed(() => sortMediaFiles(list.value?.files ?? [], sortKey.value));
const filtered = computed(() => filterMediaFiles(sorted.value, query.value));
const visible = computed(() => filtered.value.slice(0, renderLimit.value));
const existingSet = computed(() => new Set(props.existingNames ?? []));
const permissionHint = computed(() => (list.value ? describeMediaPermission(list.value) : ''));

const subtitle = computed(() => {
  const total = list.value?.files.length ?? 0;
  if (!list.value) return '';
  const parts: string[] = [];
  parts.push(query.value.trim() ? `符合 ${filtered.value.length}／${total} 個` : `共 ${total} 個 mp3／mp4`);
  if (selected.value.length) parts.push(`已選 ${selected.value.length} 個，依勾選順序加入`);
  return parts.join('，');
});

const orderOf = (uri: string) => selected.value.indexOf(uri) + 1;

const toggle = (uri: string) => {
  if (props.busy) return;
  selected.value = toggleMediaSelection(selected.value, uri);
};

/** request=false：從設定頁回來時重新整理，不再跳權限詢問。 */
const load = async (request: boolean) => {
  const seq = ++loadSeq;
  loading.value = !list.value;
  loadError.value = '';
  try {
    const result = await RadioAlarmService.listMediaFiles(request);
    if (seq !== loadSeq) return;
    list.value = result;
    now.value = new Date();
    // 重新整理後消失的檔（被刪、權限被收回）不能留在選取裡
    const alive = new Set(result.files.map((f) => f.uri));
    selected.value = selected.value.filter((u) => alive.has(u));
  } catch (e) {
    if (seq !== loadSeq) return;
    loadError.value = String((e as { message?: string })?.message ?? e);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
};

const openSettings = () => {
  RadioAlarmService.openAppSettings().catch(() => {});
};

// 從系統設定頁回來（可能剛開了權限）時重新整理；只在缺權限時做，免得每次切回 App 都重查
let resumeHandle: PluginListenerHandle | null = null;
const attachResume = async () => {
  if (resumeHandle) return;
  try {
    resumeHandle = await CapApp.addListener('resume', () => {
      if (props.show && !props.busy && permissionHint.value) void load(false);
    });
  } catch {
    resumeHandle = null;
  }
};
const detachResume = () => {
  const handle = resumeHandle;
  resumeHandle = null;
  void handle?.remove();
};

watch(
  () => props.show,
  (open) => {
    if (open) {
      query.value = '';
      sortKey.value = 'date';
      selected.value = [];
      renderLimit.value = MEDIA_PAGE_SIZE;
      list.value = null;
      void load(true);
      void attachResume();
    } else {
      loadSeq++;
      detachResume();
    }
  },
  { immediate: true },
);

watch([query, sortKey], () => {
  renderLimit.value = MEDIA_PAGE_SIZE;
});

onBeforeUnmount(detachResume);

const onShowUpdate = (value: boolean) => {
  if (!value && props.busy) return;
  emit('update:show', value);
};
</script>

<style scoped>
.mp-head {
  padding: 16px 16px 6px;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.mp-title {
  font-size: 16px;
  font-weight: bold;
  color: #0f172a;
  padding-right: 32px;
}
.mp-sub {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
  min-height: 16px;
}
.mp-search {
  margin-top: 8px;
  padding: 6px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}
.mp-sort {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 6px;
}
.mp-sort-label {
  font-size: 12px;
  color: #94a3b8;
  margin-right: 4px;
}
.mp-sort-btn {
  border: none;
  background: transparent;
  font-size: 13px;
  color: #94a3b8;
  min-height: 32px;
  padding: 0 10px;
  border-bottom: 2px solid transparent;
}
.mp-sort-btn.active {
  color: #0f172a;
  font-weight: bold;
  border-bottom-color: #0f172a;
}
.mp-hint {
  font-size: 12px;
  color: #64748b;
  margin: 4px 0 2px;
  line-height: 1.5;
}
.mp-link {
  border: none;
  background: transparent;
  padding: 0 0 0 4px;
  font-size: 12px;
  color: #0f172a;
  text-decoration: underline;
  min-height: 24px;
}
.mp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px;
  -webkit-overflow-scrolling: touch;
}
.mp-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 16px;
  font-size: 13px;
  color: #64748b;
  text-align: center;
}
.mp-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer;
}
.mp-row.selected {
  background: #f8fafc;
}
.mp-row.disabled {
  opacity: 0.6;
}
.mp-check {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin-top: 1px;
  border: 1.5px solid #cbd5e1;
  border-radius: 50%;
  font-size: 12px;
  line-height: 19px;
  text-align: center;
  color: #ffffff;
  font-variant-numeric: tabular-nums;
}
.mp-check.on {
  background: #0f172a;
  border-color: #0f172a;
  font-weight: bold;
}
.mp-info {
  flex: 1;
  min-width: 0;
}
.mp-name {
  font-size: 14px;
  color: #0f172a;
  line-height: 1.4;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mp-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0 4px;
  font-size: 11px;
  color: #64748b;
  margin-top: 3px;
}
.mp-kind {
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  padding: 0 3px;
  font-size: 10px;
  line-height: 14px;
  color: #64748b;
}
.mp-faint {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
}
.mp-plain {
  border-color: #e2e8f0;
  color: #64748b;
}
.mp-foot {
  display: flex;
  gap: 8px;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid #e2e8f0;
  flex-shrink: 0;
}
</style>

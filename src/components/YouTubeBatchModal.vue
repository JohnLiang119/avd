<template>
  <van-dialog
    :show="show"
    :title="(channelTitle || '頻道主') + ' / ' + (playlistTitle || '播放清單')"
    show-cancel-button
    confirm-button-text="開始批次下載"
    cancel-button-text="取消"
    @confirm="handleConfirm"
    @cancel="handleCancel"
    @update:show="handleShowUpdate"
    style="max-width: 520px; width: 92%;"
  >
    <div style="padding: 12px 16px; max-height: 400px; overflow-y: auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; background: #f8fafc; padding: 8px 12px; border-radius: 6px;">
        <span style="font-size: 13px; color: #64748b; font-weight: 500;">
          共 {{ visibleItems.length }} 部影片，已選取 <strong style="color: #64748b;">{{ selectedVisibleCount }}</strong> 部
        </span>
        <div style="display: flex; gap: 6px;">
          <van-button size="mini" type="primary" plain @click="selectAll">全選</van-button>
          <van-button size="mini" type="default" @click="deselectAll">全不選</van-button>
        </div>
      </div>

      <!-- 搜尋來源限定：純前端啟發式過濾，預設關閉（design D8） -->
      <div v-if="showLangFilter" style="margin-bottom: 10px; padding: 0 2px;">
        <van-checkbox v-model="onlyChinese" shape="square" icon-size="16px">
          <span style="font-size: 12px; color: #64748b;">只列中文（依標題與頻道名判斷）</span>
        </van-checkbox>
      </div>

      <div v-if="visibleItems.length === 0" style="font-size: 12px; color: #94a3b8; text-align: center; padding: 16px 0;">
        沒有判定為中文的影片，可關閉「只列中文」查看全部結果
      </div>

      <van-checkbox-group v-model="selectedIds">
        <van-cell-group inset style="margin: 0; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
          <van-cell
            v-for="item in visibleItems"
            :key="item.id"
            clickable
            @click="toggleItem(item.id)"
            style="padding: 10px 12px;"
          >
            <template #title>
              <div style="font-size: 13px; font-weight: 500; color: #0f172a; word-break: break-all; line-height: 1.4;">
                {{ item.title }}
              </div>
              <div v-if="item.durationStr" style="font-size: 11px; color: #64748b; margin-top: 2px;">
                片長 {{ item.durationStr }}
              </div>
            </template>
            <template #right-icon>
              <van-checkbox :name="item.id" @click.stop shape="square" />
            </template>
          </van-cell>
        </van-cell-group>
      </van-checkbox-group>
    </div>
  </van-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { showToast } from 'vant';
import type { PlaylistItem } from '../services/DownloadService';
import { looksChinese } from '../services/textLang';

const props = defineProps<{
  show: boolean;
  channelTitle: string;
  playlistTitle: string;
  items: PlaylistItem[];
  /** 是否顯示「只列中文」過濾開關（僅搜尋來源的明細開啟，見 design D8） */
  showLangFilter?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'confirm', selectedItems: PlaylistItem[]): void;
  (e: 'cancel'): void;
}>();

const selectedIds = ref<string[]>([]);
const onlyChinese = ref(false);

watch(
  () => props.items,
  (newItems) => {
    selectedIds.value = newItems ? newItems.map(i => i.id) : [];
    onlyChinese.value = false;
  },
  { immediate: true }
);

/**
 * 目前顯示中的項目。過濾語意為「顯示 ∩ 勾選」：計數、全選／全不選、
 * 確認下載都只作用於顯示中的項目 —— 否則「預設全選 → 開過濾 → 確認」
 * 會把看不見的非中文影片也下載下去（design D8）。
 */
const visibleItems = computed(() =>
  props.showLangFilter && onlyChinese.value
    ? props.items.filter(i => looksChinese(`${i.title} ${i.channel || ''}`))
    : props.items
);

const selectedVisibleCount = computed(
  () => visibleItems.value.filter(i => selectedIds.value.includes(i.id)).length
);

const toggleItem = (id: string) => {
  const idx = selectedIds.value.indexOf(id);
  if (idx > -1) {
    selectedIds.value.splice(idx, 1);
  } else {
    selectedIds.value.push(id);
  }
};

const selectAll = () => {
  // 只作用於顯示中的項目；被過濾隱藏者的勾選狀態不動
  const visibleIds = visibleItems.value.map(i => i.id);
  selectedIds.value = [...new Set([...selectedIds.value, ...visibleIds])];
};

const deselectAll = () => {
  const visibleIds = new Set(visibleItems.value.map(i => i.id));
  selectedIds.value = selectedIds.value.filter(id => !visibleIds.has(id));
};

const handleConfirm = () => {
  const selected = visibleItems.value.filter(i => selectedIds.value.includes(i.id));
  if (selected.length === 0) {
    showToast('請至少勾選一部影片');
    return;
  }
  emit('confirm', selected);
  emit('update:show', false);
};

const handleCancel = () => {
  emit('cancel');
  emit('update:show', false);
};

const handleShowUpdate = (val: boolean) => {
  emit('update:show', val);
};
</script>

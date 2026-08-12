<template>
  <van-dialog
    :show="show"
    :title="'📺 ' + (channelTitle || '頻道主') + ' / 📂 ' + (playlistTitle || '播放清單')"
    show-cancel-button
    confirm-button-text="🚀 開始批次下載"
    cancel-button-text="取消"
    @confirm="handleConfirm"
    @cancel="handleCancel"
    @update:show="handleShowUpdate"
    style="max-width: 520px; width: 92%;"
  >
    <div style="padding: 12px 16px; max-height: 400px; overflow-y: auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; background: #f8fafc; padding: 8px 12px; border-radius: 6px;">
        <span style="font-size: 13px; color: #475569; font-weight: 500;">
          共 {{ items.length }} 部影片，已選取 <strong style="color: #2563eb;">{{ selectedIds.length }}</strong> 部
        </span>
        <div style="display: flex; gap: 6px;">
          <van-button size="mini" type="primary" plain @click="selectAll">全選</van-button>
          <van-button size="mini" type="default" @click="deselectAll">全不選</van-button>
        </div>
      </div>

      <van-checkbox-group v-model="selectedIds">
        <van-cell-group inset style="margin: 0; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
          <van-cell
            v-for="item in items"
            :key="item.id"
            clickable
            @click="toggleItem(item.id)"
            style="padding: 10px 12px;"
          >
            <template #title>
              <div style="font-size: 13px; font-weight: 500; color: #1e293b; word-break: break-all; line-height: 1.4;">
                {{ item.title }}
              </div>
              <div v-if="item.durationStr" style="font-size: 11px; color: #64748b; margin-top: 2px;">
                ⏱️ 片長: {{ item.durationStr }}
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
import { ref, watch } from 'vue';
import { showToast } from 'vant';
import type { PlaylistItem } from '../services/DownloadService';

const props = defineProps<{
  show: boolean;
  channelTitle: string;
  playlistTitle: string;
  items: PlaylistItem[];
}>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'confirm', selectedItems: PlaylistItem[]): void;
  (e: 'cancel'): void;
}>();

const selectedIds = ref<string[]>([]);

watch(
  () => props.items,
  (newItems) => {
    selectedIds.value = newItems ? newItems.map(i => i.id) : [];
  },
  { immediate: true }
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
  selectedIds.value = props.items.map(i => i.id);
};

const deselectAll = () => {
  selectedIds.value = [];
};

const handleConfirm = () => {
  if (selectedIds.value.length === 0) {
    showToast('請至少勾選一部影片');
    return;
  }
  const selected = props.items.filter(i => selectedIds.value.includes(i.id));
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

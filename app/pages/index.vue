<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';

interface ShoppingItem {
  id: string;
  text: string;
  checked: boolean;
  category?: string;
}

interface ShoppingGroup {
  name: string;
  list: ShoppingItem[];
}

interface FetchItemsOptions {
  /** 購入済み処理中も更新するかどうか */
  force?: boolean;
}

interface AddItemResponse {
  id: string;
  category?: string;
}

interface PurchaseResponse {
  status: 'success';
}

const POLL_INTERVAL_MS = 5000;
const SYNC_BADGE_VISIBLE_MS = 800;
const TOAST_VISIBLE_MS = 3000;
const UNCLASSIFIED_CATEGORY = '未分類';
const UNCLASSIFIED_GROUP_NAME = '未分類（その他）';

const items = ref<ShoppingItem[]>([]);
const categories = ref<string[]>([]);
const isFetchLoading = ref(false);
const isPurchaseLoading = ref(false);
const isAiSortLoading = ref(false);
const isAiSorted = ref(false);
const syncActive = ref(false);
const syncingItemIds = ref<string[]>([]);
const addDialog = ref<HTMLDialogElement | null>(null);
const itemInput = ref<HTMLInputElement | null>(null);
const newItemText = ref('');
const isAddLoading = ref(false);
const showToast = ref(false);
const toastMessage = ref('');
const toastType = ref<'success' | 'error'>('success');

let pollTimer: ReturnType<typeof setInterval> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 選択済みのアイテムIDを返します。
 *
 * @returns アイテムID
 */
const checkedItemIds = computed(() => {
  return items.value.filter(item => item.checked).map(item => item.id);
});

/**
 * 現在の表示順に合わせたアイテムグループを返します。
 *
 * @returns 表示するアイテムグループ
 */
const displayedGroups = computed<ShoppingGroup[]>(() => {
  if (!isAiSorted.value) {
    return [{ name: '', list: items.value }];
  }

  const groups = new Map<string, ShoppingItem[]>();
  categories.value.forEach(category => groups.set(category, []));
  groups.set(UNCLASSIFIED_CATEGORY, []);

  items.value.forEach(item => {
    const category = item.category && groups.has(item.category)
      ? item.category
      : UNCLASSIFIED_CATEGORY;
    groups.get(category)?.push(item);
  });

  const displayed = categories.value
    .map(category => ({ name: category, list: groups.get(category) || [] }))
    .filter(group => group.list.length > 0);
  const unclassifiedItems = groups.get(UNCLASSIFIED_CATEGORY) || [];
  if (unclassifiedItems.length > 0) {
    displayed.push({
      name: UNCLASSIFIED_GROUP_NAME,
      list: unclassifiedItems,
    });
  }

  return displayed;
});

/**
 * トースト通知を表示します。
 *
 * @param message 通知メッセージ
 * @param type 通知の成否タイプ
 */
function displayToast(message: string, type: 'success' | 'error' = 'success'): void {
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
  }

  toastMessage.value = message;
  toastType.value = type;
  showToast.value = true;
  toastTimer = setTimeout(() => {
    showToast.value = false;
    toastTimer = null;
  }, TOAST_VISIBLE_MS);
}

/**
 * 指定したアイテムが同期中かどうかを返します。
 *
 * @param itemId アイテムID
 * @returns 同期中かどうか
 */
function isSyncing(itemId: string): boolean {
  return syncingItemIds.value.includes(itemId);
}

/**
 * Google Keepから最新の買い物リストを取得します。
 * ※ 同期中のチェック状態は画面側の状態を維持する
 *
 * @param options 更新オプション
 */
async function fetchItems(options: FetchItemsOptions = {}): Promise<void> {
  if (isPurchaseLoading.value && !options.force) {
    return;
  }

  syncActive.value = true;
  try {
    const data = await $fetch<{ items: ShoppingItem[] }>('/api/items');
    items.value = data.items.map(fetchedItem => {
      if (!isSyncing(fetchedItem.id)) {
        return fetchedItem;
      }

      const currentItem = items.value.find(item => item.id === fetchedItem.id);
      return currentItem
        ? { ...fetchedItem, checked: currentItem.checked }
        : fetchedItem;
    });
  } catch (error) {
    console.error('買い物リストの取得に失敗しました:', error);
  } finally {
    setTimeout(() => {
      syncActive.value = false;
    }, SYNC_BADGE_VISIBLE_MS);
  }
}

/**
 * チェック状態をサーバーと同期します。
 *
 * @param item 対象の買い物アイテム
 */
async function handleCheckToggle(item: ShoppingItem): Promise<void> {
  if (isSyncing(item.id)) {
    return;
  }

  syncingItemIds.value = [...syncingItemIds.value, item.id];
  const originalChecked = item.checked;
  item.checked = !item.checked;

  try {
    await $fetch('/api/check', {
      method: 'POST',
      body: {
        id: item.id,
        checked: item.checked,
      },
    });
  } catch (error) {
    console.error('チェック状態の同期に失敗しました:', error);
    item.checked = originalChecked;
    displayToast('同期に失敗しました。', 'error');
  } finally {
    syncingItemIds.value = syncingItemIds.value.filter(itemId => itemId !== item.id);
  }
}

/**
 * 選択済みアイテムをGoogle Keepで購入済みにします。
 */
async function purchaseCheckedItems(): Promise<void> {
  const itemIds = checkedItemIds.value;
  if (itemIds.length === 0) {
    return;
  }

  isPurchaseLoading.value = true;
  try {
    await $fetch<PurchaseResponse>('/api/items', {
      method: 'POST',
      body: { ids: itemIds },
    });

    items.value = items.value.filter(item => !itemIds.includes(item.id));
    displayToast('購入済みにしました。', 'success');
    void fetchItems({ force: true });
  } catch (error) {
    console.error('購入済み処理に失敗しました:', error);
    displayToast('処理に失敗しました。', 'error');
  } finally {
    isPurchaseLoading.value = false;
  }
}

/**
 * AI陳列順表示の有効と無効を切り替えます。
 */
async function toggleAiSort(): Promise<void> {
  if (isAiSorted.value) {
    isAiSorted.value = false;
    return;
  }

  isAiSorted.value = true;
  const unclassifiedItems = items.value.filter(item => !item.category);
  if (unclassifiedItems.length === 0) {
    return;
  }

  isAiSortLoading.value = true;
  try {
    const response = await $fetch<{ items: Array<{ id: string; category: string }> }>('/api/sort', {
      method: 'POST',
      body: {
        items: items.value.map(item => ({ id: item.id, text: item.text })),
      },
    });
    const categoriesById = new Map(response.items.map(item => [item.id, item.category]));
    items.value = items.value.map(item => ({
      ...item,
      category: categoriesById.get(item.id) || item.category,
    }));
  } catch (error) {
    console.error('AI陳列順への分類に失敗しました:', error);
    displayToast('一部のAI分類に失敗しました。', 'error');
  } finally {
    isAiSortLoading.value = false;
  }
}

/**
 * アイテム追加画面を開きます。
 */
async function openAddDialog(): Promise<void> {
  newItemText.value = '';
  addDialog.value?.showModal();
  await nextTick();
  itemInput.value?.focus();
}

/**
 * アイテム追加画面を閉じます。
 */
function closeAddDialog(): void {
  addDialog.value?.close();
}

/**
 * 新しいアイテムをGoogle Keepへ登録します。
 */
async function submitAddItem(): Promise<void> {
  const text = newItemText.value.trim();
  if (text.length === 0) {
    return;
  }

  isAddLoading.value = true;
  try {
    const response = await $fetch<AddItemResponse>('/api/items/add', {
      method: 'POST',
      body: { text },
    });
    const newItem: ShoppingItem = {
      id: response.id,
      text,
      checked: false,
      category: response.category,
    };
    items.value = [...items.value, newItem];

    displayToast('アイテムを登録しました。', 'success');
    closeAddDialog();
    void fetchItems({ force: true });
  } catch (error) {
    console.error('アイテムの登録に失敗しました:', error);
    displayToast('アイテムの登録に失敗しました。', 'error');
  } finally {
    isAddLoading.value = false;
  }
}

/**
 * 買い物リストを手動で更新します。
 */
async function handleManualRefresh(): Promise<void> {
  isFetchLoading.value = true;
  try {
    await fetchItems();
  } finally {
    isFetchLoading.value = false;
  }
}

/**
 * 表示カテゴリーを取得します。
 */
async function fetchCategories(): Promise<void> {
  try {
    const data = await $fetch<{ categories: string[] }>('/api/config');
    categories.value = data.categories;
  } catch (error) {
    console.error('カテゴリー設定の取得に失敗しました:', error);
  }
}

/**
 * 初期表示に必要な情報を取得します。
 */
async function initializePage(): Promise<void> {
  isFetchLoading.value = true;
  await Promise.all([fetchCategories(), fetchItems()]);
  isFetchLoading.value = false;
  pollTimer = setInterval(() => {
    void fetchItems();
  }, POLL_INTERVAL_MS);
}

/**
 * 画面で使用したタイマーを停止します。
 */
function cleanupPage(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
  }
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
  }
}

onMounted(initializePage);
onUnmounted(cleanupPage);

useHead({
  title: '買い物リスト',
  link: [
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/icon?family=Material+Icons' },
  ],
});
</script>

<template>
  <div>
    <Transition name="toast">
      <div
        v-if="showToast"
        class="toast-notification"
        :class="`is-${toastType}`"
        :role="toastType === 'error' ? 'alert' : 'status'"
      >
        {{ toastMessage }}
      </div>
    </Transition>

    <header class="app-header">
      <h1 class="app-title">買い物リスト</h1>
      <div class="header-actions">
        <span class="sync-badge" :class="syncActive ? 'is-syncing' : 'is-synced'">
          <span class="sync-dot" :class="syncActive ? 'is-syncing' : 'is-synced'"/>
          {{ syncActive ? '同期中...' : '同期済み' }}
        </span>
        <button
          type="button"
          class="refresh-btn"
          :disabled="isFetchLoading"
          :aria-busy="isFetchLoading"
          aria-label="リストを更新"
          @click="handleManualRefresh"
        >
          <span v-if="isFetchLoading" class="spinner"/>
          <span v-else class="refresh-icon-container">
            <span class="material-icons refresh-icon" aria-hidden="true">refresh</span>
          </span>
        </button>
      </div>
    </header>

    <main class="app-content">
      <div v-if="items.length === 0 && isFetchLoading" class="empty-state">
        <span class="spinner dark-spinner"/>
        <p class="empty-text loading-text">リストを読み込んでいます...</p>
      </div>

      <div v-else-if="items.length === 0" class="empty-state">
        <div class="empty-icon" aria-hidden="true">✓</div>
        <p class="empty-text">買い物リストは空です。</p>
      </div>

      <div v-else class="shopping-list">
        <section v-for="group in displayedGroups" :key="group.name || 'default'" class="category-group">
          <h2 v-if="group.name" class="category-title">{{ group.name }}</h2>
          <div class="items-container">
            <label
              v-for="item in group.list"
              :key="item.id"
              class="item-row"
              :class="{ 'is-checked': item.checked, 'is-updating': isSyncing(item.id) }"
            >
              <span class="item-content">
                <span class="checkbox-container">
                  <input
                    type="checkbox"
                    :checked="item.checked"
                    :disabled="isSyncing(item.id)"
                    @change="handleCheckToggle(item)"
                  >
                  <span class="checkmark"/>
                </span>
                <span class="item-text">{{ item.text }}</span>
              </span>
            </label>
          </div>
        </section>
      </div>
    </main>

    <footer class="app-footer">
      <button
        type="button"
        class="btn btn-secondary"
        :class="{ 'is-active': isAiSorted }"
        :disabled="isAiSortLoading || items.length === 0"
        :aria-busy="isAiSortLoading"
        @click="toggleAiSort"
      >
        <span v-if="isAiSortLoading" class="spinner"/>
        <span>{{ isAiSorted ? '通常順に戻す' : '✨ AI陳列順ソート' }}</span>
      </button>

      <button
        type="button"
        class="btn btn-primary"
        :disabled="checkedItemIds.length === 0 || isPurchaseLoading"
        :aria-busy="isPurchaseLoading"
        @click="purchaseCheckedItems"
      >
        <span v-if="isPurchaseLoading" class="spinner"/>
        <span v-else>購入済み ({{ checkedItemIds.length }})</span>
      </button>
    </footer>

    <button type="button" class="fab-btn" aria-label="アイテムを追加" @click="openAddDialog">
      <span class="material-icons" aria-hidden="true">add</span>
    </button>

    <dialog ref="addDialog" class="add-dialog" @click.self="closeAddDialog" @close="newItemText = ''">
      <div class="dialog-content">
        <header class="dialog-header">
          <h2 class="dialog-title">アイテムを追加</h2>
          <button type="button" class="close-btn" aria-label="閉じる" @click="closeAddDialog">
            <span class="material-icons" aria-hidden="true">close</span>
          </button>
        </header>
        <form class="dialog-form" @submit.prevent="submitAddItem">
          <label class="sr-only" for="item-text">アイテム名</label>
          <input
            id="item-text"
            ref="itemInput"
            v-model="newItemText"
            type="text"
            placeholder="例: 牛乳、たまご"
            required
            autocomplete="off"
            class="dialog-input"
            :disabled="isAddLoading"
          >
          <div class="dialog-actions">
            <button type="button" class="btn btn-secondary" :disabled="isAddLoading" @click="closeAddDialog">
              キャンセル
            </button>
            <button type="submit" class="btn btn-primary" :disabled="isAddLoading || !newItemText.trim()">
              <span v-if="isAddLoading" class="spinner"/>
              <span v-else>登録</span>
            </button>
          </div>
        </form>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.refresh-icon-container {
  display: flex;
  align-items: center;
  justify-content: center;
}

.refresh-icon {
  font-size: 18px;
  line-height: 1;
}

.dark-spinner {
  width: 24px;
  height: 24px;
  border-top-color: var(--color-text-primary);
}

.loading-text {
  margin-top: 12px;
}

.items-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item-content {
  display: flex;
  flex: 1;
  gap: 14px;
  align-items: flex-start;
}

.fab-btn {
  position: fixed;
  right: max(20px, calc((100vw - 480px) / 2 + 20px));
  bottom: 92px;
  z-index: 9;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  color: var(--color-btn-text);
  cursor: pointer;
  background-color: var(--color-btn-bg);
  border: 1px solid var(--color-border-dark);
  border-radius: 50%;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.fab-btn:active {
  transform: scale(0.95);
}

.fab-btn .material-icons {
  font-size: 24px;
}

.add-dialog {
  width: calc(100% - 40px);
  max-width: 400px;
  padding: 0;
  margin: auto;
  background: transparent;
  border: none;
}

.add-dialog::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.dialog-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background-color: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dialog-title {
  font-size: 1rem;
  font-weight: 600;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  color: var(--color-text-secondary);
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 50%;
}

.close-btn:active {
  background-color: var(--color-border);
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dialog-input {
  padding: 10px 12px;
  font-family: var(--font-sans);
  font-size: 0.95rem;
  color: var(--color-text-primary);
  background-color: var(--color-bg);
  border: 1px solid var(--color-border-dark);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.2s ease;
}

.dialog-input:focus {
  border-color: var(--color-text-primary);
}

.dialog-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-color-scheme: dark) {
  .fab-btn {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  }

  .dialog-content {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }
}
</style>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

interface ShoppingItem {
  ts: string;
  text: string;
  user: string;
  tsFormatted: string;
  checked: boolean;
  /** AIソート時の分類 */
  category?: string;
}

interface ShoppingGroup {
  name: string;
  list: ShoppingItem[];
}

interface FetchItemsOptions {
  /** 購入済み処理中でも更新するかどうか */
  force?: boolean;
}

const POLL_INTERVAL_MS = 5000;
const SYNC_BADGE_VISIBLE_MS = 800;
const TOAST_VISIBLE_MS = 3000;
const USER_NAME_MAX_LENGTH = 4;
const UNCLASSIFIED_CATEGORY = '未分類';
const UNCLASSIFIED_GROUP_NAME = '未分類 (その他)';

const items = ref<ShoppingItem[]>([]);
const categories = ref<string[]>([]);
const isFetchLoading = ref(false);
const isDeleteLoading = ref(false);
const isAiSortLoading = ref(false);
const isAiSorted = ref(false);
const syncActive = ref(false);
const updatingTsList = ref<string[]>([]);

const showToast = ref(false);
const toastMessage = ref('');
const toastType = ref<'success' | 'error'>('success');

let pollTimer: ReturnType<typeof setInterval> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const aiCategoryCache = new Map<string, string>();

/** チェック済みアイテムのSlackメッセージID一覧 */
const checkedTsList = computed(() => {
  return items.value.filter(item => item.checked).map(item => item.ts);
});

/** AIソート適用時の表示グループ一覧 */
const groupedItems = computed<ShoppingGroup[]>(() => {
  if (!isAiSorted.value) {
    return [];
  }

  const groups: Record<string, ShoppingItem[]> = {};

  categories.value.forEach(category => {
    groups[category] = [];
  });
  groups[UNCLASSIFIED_CATEGORY] = [];

  items.value.forEach(item => {
    const category = item.category || UNCLASSIFIED_CATEGORY;
    if (groups[category]) {
      groups[category].push(item);
    } else {
      groups[UNCLASSIFIED_CATEGORY]!.push(item);
    }
  });

  const result = categories.value.map(category => ({
    name: category,
    list: groups[category] || [],
  })).filter(group => group.list.length > 0);

  const unclassifiedItems = groups[UNCLASSIFIED_CATEGORY] || [];
  if (unclassifiedItems.length > 0) {
    result.push({
      name: UNCLASSIFIED_GROUP_NAME,
      list: unclassifiedItems,
    });
  }

  return result;
});

/**
 * トースト通知を表示します。
 * 
 * @param message メッセージ
 * @param type 通知の成否タイプ
 */
function displayToast(message: string, type: 'success' | 'error' = 'success') {
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastMessage.value = message;
  toastType.value = type;
  showToast.value = true;
  toastTimer = setTimeout(() => {
    showToast.value = false;
  }, TOAST_VISIBLE_MS);
}

/**
 * 指定したアイテムがサーバー同期中かどうかを返します。
 *
 * @param ts SlackメッセージID
 * @returns 同期中かどうか
 */
function isUpdating(ts: string): boolean {
  return updatingTsList.value.includes(ts);
}

/**
 * AIソート中のアイテムにキャッシュ済みカテゴリーを反映します。
 *
 * @param item 対象アイテム
 * @returns カテゴリーを反映したアイテム
 */
function withAiCategory(item: ShoppingItem): ShoppingItem {
  return {
    ...item,
    category: aiCategoryCache.get(item.ts),
  };
}

/**
 * 画面に収まる投稿者名を返します。
 *
 * @param user 投稿者名
 * @returns 短縮済み投稿者名
 */
function formatUserName(user: string): string {
  return user.length > USER_NAME_MAX_LENGTH
    ? `${user.slice(0, USER_NAME_MAX_LENGTH)}...`
    : user;
}

/**
 * Slackから最新の買い物リストを取得します。
 * ※ 他ユーザーのチェック状態も含めて同期する
 *
 * @param options 更新オプション
 */
async function fetchItems(options: FetchItemsOptions = {}) {
  const shouldSkipPolling = isDeleteLoading.value && !options.force;
  if (shouldSkipPolling) {
    return;
  }

  syncActive.value = true;
  try {
    const data = await $fetch<{ items: ShoppingItem[] }>('/api/items');
    const protectedItems = data.items.map(fetchedItem => {
      if (!isUpdating(fetchedItem.ts)) {
        return fetchedItem;
      }

      const currentItem = items.value.find(item => item.ts === fetchedItem.ts);
      return currentItem
        ? { ...fetchedItem, checked: currentItem.checked }
        : fetchedItem;
    });

    items.value = isAiSorted.value
      ? protectedItems.map(withAiCategory)
      : protectedItems;
  } catch (error) {
    console.error('Failed to fetch items:', error);
  } finally {
    setTimeout(() => {
      syncActive.value = false;
    }, SYNC_BADGE_VISIBLE_MS);
  }
}

/**
 * チェック状態が切り替わったときにサーバーに同期します。
 * 
 * @param item 対象の買い物アイテム
 */
async function handleCheckToggle(item: ShoppingItem) {
  if (isUpdating(item.ts)) {
    return;
  }

  updatingTsList.value = [...updatingTsList.value, item.ts];
  const originalChecked = item.checked;

  // 画面状態の先行反映
  item.checked = !item.checked;

  try {
    await $fetch('/api/check', {
      method: 'POST',
      body: {
        ts: item.ts,
        checked: item.checked,
      },
    });
  } catch (error) {
    console.error('Failed to sync check state:', error);
    item.checked = originalChecked;
    displayToast('同期に失敗しました。', 'error');
  } finally {
    updatingTsList.value = updatingTsList.value.filter(updatingTs => updatingTs !== item.ts);
  }
}

/**
 * チェックされたアイテムをまとめてSlackから購入済みにします。
 * ※ 対象アイテムのSlackメッセージにリアクションを追加する
 */
async function deleteCheckedItems() {
  const tsList = checkedTsList.value;
  if (tsList.length === 0) {
    return;
  }

  isDeleteLoading.value = true;
  try {
    const res = await $fetch<{ status: string; message: string }>('/api/items', {
      method: 'POST',
      body: { tsList },
    });
    if (res && res.status === 'partial_success') {
      displayToast('一部の処理に失敗しました。', 'error');
    } else {
      displayToast('購入済みにしました。', 'success');
    }
    
    await fetchItems({ force: true });
  } catch (error) {
    console.error('Failed to update items:', error);
    displayToast('処理に失敗しました。', 'error');
  } finally {
    isDeleteLoading.value = false;
  }
}

/**
 * AIソートの有効と無効を切り替えます。
 * ※ スーパーの陳列順へのソートを行う
 */
async function toggleAiSort() {
  if (isAiSorted.value) {
    isAiSorted.value = false;
    return;
  }

  if (items.value.length === 0) {
    isAiSorted.value = true;
    return;
  }

  const hasAllCache = items.value.every(item => aiCategoryCache.has(item.ts));
  if (hasAllCache) {
    items.value = items.value.map(withAiCategory);
    isAiSorted.value = true;
    return;
  }

  isAiSortLoading.value = true;
  try {
    const res = await $fetch<{ items: Array<{ ts: string, category: string }> }>('/api/sort', {
      method: 'POST',
      body: {
        items: items.value.map(item => ({ ts: item.ts, text: item.text })),
      },
    });

    if (res && res.items) {
      aiCategoryCache.clear();
      res.items.forEach(item => {
        aiCategoryCache.set(item.ts, item.category);
      });

      items.value = items.value.map(withAiCategory);
      isAiSorted.value = true;
    }
  } catch (error) {
    console.error('Failed to sort items via AI:', error);
    displayToast('AIソートに失敗しました。', 'error');
  } finally {
    isAiSortLoading.value = false;
  }
}

/**
 * 手動でリストを更新します。
 */
async function handleManualRefresh() {
  isFetchLoading.value = true;
  await fetchItems();
  isFetchLoading.value = false;
}

onMounted(async () => {
  isFetchLoading.value = true;
  try {
    const configData = await $fetch<{ categories: string[] }>('/api/config');
    if (configData && configData.categories) {
      categories.value = configData.categories;
    }
  } catch (error) {
    console.error('Failed to fetch config:', error);
  }
  await fetchItems();
  isFetchLoading.value = false;

  pollTimer = setInterval(() => {
    void fetchItems();
  }, POLL_INTERVAL_MS);
});

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
});

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
      <div v-if="showToast" class="toast-notification" :class="`is-${toastType}`">
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
          class="refresh-btn" 
          :disabled="isFetchLoading" 
          aria-label="リストを更新"
          @click="handleManualRefresh"
        >
          <span v-if="isFetchLoading" class="spinner"/>
          <span v-else class="refresh-icon-container">
            <span class="material-icons refresh-icon">refresh</span>
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
        <div class="empty-icon">✓</div>
        <p class="empty-text">現在、買い物リストは空です。<br>Slackに対象アイテムを投稿してください。</p>
      </div>

      <div v-else>
        <div v-if="isAiSorted" class="shopping-list">
          <div v-for="group in groupedItems" :key="group.name" class="category-group">
            <h2 class="category-title">{{ group.name }}</h2>
            <div class="items-container">
              <div 
                v-for="item in group.list" 
                :key="item.ts" 
                class="item-row"
                :class="{ 'is-checked': item.checked, 'is-updating': isUpdating(item.ts) }"
                @click="handleCheckToggle(item)"
              >
                <div class="item-content">
                  <div class="checkbox-container">
                    <input type="checkbox" :checked="item.checked" readonly >
                    <span class="checkmark"/>
                  </div>
                  <span class="item-text">{{ item.text }}</span>
                </div>
                <div class="item-meta">
                  <span class="meta-user" :title="item.user">
                    {{ formatUserName(item.user) }}
                  </span>
                  <span class="meta-time">{{ item.tsFormatted }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="shopping-list">
          <div 
            v-for="item in items" 
            :key="item.ts" 
            class="item-row"
            :class="{ 'is-checked': item.checked, 'is-updating': isUpdating(item.ts) }"
            @click="handleCheckToggle(item)"
          >
            <div class="item-content">
              <div class="checkbox-container">
                <input type="checkbox" :checked="item.checked" readonly >
                <span class="checkmark"/>
              </div>
              <span class="item-text">{{ item.text }}</span>
            </div>
            <div class="item-meta">
              <span class="meta-user" :title="item.user">
                {{ formatUserName(item.user) }}
              </span>
              <span class="meta-time">{{ item.tsFormatted }}</span>
            </div>
          </div>
        </div>
      </div>
    </main>

    <footer class="app-footer">
      <button 
        class="btn btn-secondary" 
        :class="{ 'is-active': isAiSorted }"
        :disabled="isAiSortLoading || items.length === 0" 
        @click="toggleAiSort"
      >
        <span v-if="isAiSortLoading" class="spinner"/>
        <span v-else-if="isAiSorted">✨ 通常順に戻す</span>
        <span v-else>✨ AI陳列順ソート</span>
      </button>

      <button 
        class="btn btn-primary" 
        :disabled="checkedTsList.length === 0 || isDeleteLoading" 
        @click="deleteCheckedItems"
      >
        <span v-if="isDeleteLoading" class="spinner"/>
        <span v-else>購入済み ({{ checkedTsList.length }})</span>
      </button>
    </footer>
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
  border-top-color: var(--color-text-primary);
  width: 24px;
  height: 24px;
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
  align-items: flex-start;
  gap: 14px;
  flex: 1;
}
</style>

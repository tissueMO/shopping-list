<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

interface ShoppingItem {
  ts: string;
  text: string;
  user: string;
  tsFormatted: string;
  checked: boolean;
  category?: string; // AIソート時に割り当てられるカテゴリー
}

const items = ref<ShoppingItem[]>([]);
const categories = ref<string[]>([]);
const isFetchLoading = ref(false);
const isDeleteLoading = ref(false);
const isAiSortLoading = ref(false);
const isAiSorted = ref(false);
const syncActive = ref(false);

const showToast = ref(false);
const toastMessage = ref('');
const toastType = ref<'success' | 'error'>('success');

let pollTimer: NodeJS.Timeout | null = null;
let toastTimer: NodeJS.Timeout | null = null;

const aiCategoryCache = new Map<string, string>();

// チェックされたアイテムのtsリスト
const checkedTsList = computed(() => {
  return items.value.filter(item => item.checked).map(item => item.ts);
});

// AIソート適用時と通常時のアイテムグループ
const groupedItems = computed(() => {
  if (!isAiSorted.value) {
    return [];
  }

  const groups: Record<string, ShoppingItem[]> = {};
  
  // 初期化
  categories.value.forEach(cat => {
    groups[cat] = [];
  });
  groups['未分類'] = [];

  // 分配
  items.value.forEach(item => {
    const cat = item.category || '未分類';
    if (groups[cat]) {
      groups[cat].push(item);
    } else {
      groups['未分類']!.push(item);
    }
  });

  const result = categories.value.map(cat => ({
    name: cat,
    list: groups[cat] || [],
  })).filter(g => g.list.length > 0);

  if (groups['未分類'] && groups['未分類'].length > 0) {
    result.push({
      name: '未分類 (その他)',
      list: groups['未分類'],
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
  }, 3000);
}

/**
 * Slackから最新の買い物リストを取得します。
 * ※ 他ユーザーのチェック状態も含めて同期する
 */
async function fetchItems() {
  syncActive.value = true;
  try {
    const data = await $fetch<{ items: ShoppingItem[] }>('/api/items');
    if (data && data.items) {
      const newTsList = data.items.map(i => i.ts);
      const currentTsList = items.value.map(i => i.ts);

      // アイテムリストが完全に同一であるかどうかのチェック
      const isListIdentical = newTsList.length === currentTsList.length &&
        newTsList.every((ts, idx) => ts === currentTsList[idx]);

      if (isListIdentical) {
        items.value = isAiSorted.value
          ? data.items.map(item => ({
              ...item,
              category: aiCategoryCache.get(item.ts) || item.category,
            }))
          : data.items;
      } else {
        if (isAiSorted.value) {
          isAiSorted.value = false;
          aiCategoryCache.clear();
        }
        items.value = data.items;
      }
    }
  } catch (error) {
    console.error('Failed to fetch items:', error);
  } finally {
    // 同期インジケータの点滅表示
    setTimeout(() => {
      syncActive.value = false;
    }, 800);
  }
}

/**
 * チェック状態が切り替わったときにサーバーに同期します。
 * 
 * @param item 対象の買い物アイテム
 */
async function handleCheckToggle(item: ShoppingItem) {
  // 楽観的アップデート（UI側を先に書き換える）
  item.checked = !item.checked;

  // エラー時の状態復元
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
    item.checked = !item.checked;
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
    
    // 処理完了後に再取得
    await fetchItems();
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

  // リストに変更がない場合、キャッシュされたカテゴリーを再利用
  const hasAllCache = items.value.every(item => aiCategoryCache.has(item.ts));
  if (hasAllCache) {
    items.value = items.value.map(item => ({
      ...item,
      category: aiCategoryCache.get(item.ts),
    }));
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

    // キャッシュへの保存
    if (res && res.items) {
      aiCategoryCache.clear();
      res.items.forEach(i => {
        aiCategoryCache.set(i.ts, i.category);
      });

      items.value = items.value.map(item => ({
        ...item,
        category: aiCategoryCache.get(item.ts),
      }));
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

  // 5秒ごとに自動同期ポーリングを実行
  pollTimer = setInterval(fetchItems, 5000);
});

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
});

// ページタイトルとMaterial Iconsの設定
useHead({
  title: '買い物リスト',
  link: [
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/icon?family=Material+Icons' },
  ],
});
</script>

<template>
  <div>
    <!-- トースト通知 -->
    <Transition name="toast">
      <div v-if="showToast" class="toast-notification" :class="`is-${toastType}`">
        {{ toastMessage }}
      </div>
    </Transition>

    <!-- ヘッダーエリア -->
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
            <!-- Material Icons リロードアイコン -->
            <span class="material-icons refresh-icon">refresh</span>
          </span>
        </button>
      </div>
    </header>

    <!-- メインコンテンツ -->
    <main class="app-content">
      <!-- 読み込み中 (初回) -->
      <div v-if="items.length === 0 && isFetchLoading" class="empty-state">
        <span class="spinner dark-spinner"/>
        <p class="empty-text loading-text">リストを読み込んでいます...</p>
      </div>

      <!-- 空白状態 -->
      <div v-else-if="items.length === 0" class="empty-state">
        <div class="empty-icon">✓</div>
        <p class="empty-text">現在、買い物リストは空です。<br>Slackに対象アイテムを投稿してください。</p>
      </div>

      <div v-else>
        <!-- AIソート表示モード -->
        <div v-if="isAiSorted" class="shopping-list">
          <div v-for="group in groupedItems" :key="group.name" class="category-group">
            <h2 class="category-title">{{ group.name }}</h2>
            <div class="items-container">
              <div 
                v-for="item in group.list" 
                :key="item.ts" 
                class="item-row"
                :class="{ 'is-checked': item.checked }"
                @click="handleCheckToggle(item)"
              >
                <!-- 左側：チェックボックス＋アイテムテキスト -->
                <div class="item-content">
                  <div class="checkbox-container">
                    <input type="checkbox" :checked="item.checked" readonly >
                    <span class="checkmark"/>
                  </div>
                  <span class="item-text">{{ item.text }}</span>
                </div>
                <!-- 右側：投稿ユーザー名と投稿日時を縦積み -->
                <div class="item-meta">
                  <span class="meta-user" :title="item.user">
                    {{ item.user.length > 4 ? item.user.slice(0, 4) + '...' : item.user }}
                  </span>
                  <span class="meta-time">{{ item.tsFormatted }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 通常の投稿順（昇順）表示モード -->
        <div v-else class="shopping-list">
          <div 
            v-for="item in items" 
            :key="item.ts" 
            class="item-row"
            :class="{ 'is-checked': item.checked }"
            @click="handleCheckToggle(item)"
          >
            <!-- 左側：チェックボックス＋アイテムテキスト -->
            <div class="item-content">
              <div class="checkbox-container">
                <input type="checkbox" :checked="item.checked" readonly >
                <span class="checkmark"/>
              </div>
              <span class="item-text">{{ item.text }}</span>
            </div>
            <!-- 右側：投稿ユーザー名と投稿日時を縦積み -->
            <div class="item-meta">
              <span class="meta-user" :title="item.user">
                {{ item.user.length > 4 ? item.user.slice(0, 4) + '...' : item.user }}
              </span>
              <span class="meta-time">{{ item.tsFormatted }}</span>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- フッター操作パネル -->
    <footer class="app-footer">
      <!-- AIソートボタン -->
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

      <!-- 購入済み（Slackリアクション追加）ボタン -->
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

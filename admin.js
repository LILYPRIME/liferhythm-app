const ADMIN_EMAIL = 'daqiaoling0@gmail.com';
const firebaseConfig = {
  apiKey: 'AIzaSyAch5QXGqpzu2ZzR4LGVuxiGmV8Y_BBt-I',
  authDomain: 'liferhythm-cb0e2.firebaseapp.com',
  projectId: 'liferhythm-cb0e2',
  storageBucket: 'liferhythm-cb0e2.firebasestorage.app',
  messagingSenderId: '549059630729',
  appId: '1:549059630729:web:36fb8d5440644caab01858'
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const RANKS = [
  { name: 'Bronze', min: 0, max: 999, cls: 'rank-bronze', order: 0 },
  { name: 'Silver', min: 1000, max: 2999, cls: 'rank-silver', order: 1 },
  { name: 'Gold', min: 3000, max: 5999, cls: 'rank-gold', order: 2 },
  { name: 'Platinum', min: 6000, max: 9999, cls: 'rank-platinum', order: 3 },
  { name: 'Diamond', min: 10000, max: Infinity, cls: 'rank-diamond', order: 4 }
];
const ENT_NAMES = { yt: 'YouTube', tt: 'TikTok', tw: 'X', ig: 'Instagram', nt: 'Netflix', gm: 'ゲーム' };
const FUNNEL_STEPS = [
  { key: 'guestStart', label: 'ゲスト開始' },
  { key: 'tutorialComplete', label: 'チュートリアル' },
  { key: 'firstTodoAdded', label: '初回追加' },
  { key: 'firstTodoDone', label: '初回完了' },
  { key: 'firstUnlock', label: '初回解除' }
];

let allUsers = [];
let allGuests = [];
let allEvents = [];
let allFeedback = [];
let userSortKey = 'totalEarned';
let userSortAsc = false;
let guestSortKey = 'lastActive';
let guestSortAsc = false;
let feedbackSortKey = 'createdAt';
let feedbackSortAsc = false;
const expandedUsers = new Set();

function getRank(total) {
  return RANKS.find(rank => total >= rank.min && total <= rank.max) || RANKS[0];
}
function safeNum(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}
function esc(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(ts) {
  if (!ts) return '未記録';
  try {
    return new Date(ts).toLocaleString('ja-JP', {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch (error) {
    return '未記録';
  }
}
function shortDate(ts) {
  if (!ts) return '未記録';
  try {
    return new Date(ts).toLocaleString('ja-JP', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch (error) {
    return '未記録';
  }
}
function fmtSource(source) {
  const map = { lp: 'LP', app: 'App', root: 'Root', direct: 'Direct', unknown: '不明' };
  return map[source] || source || '不明';
}
function uniqueCount(items, getKey) {
  const set = new Set();
  items.forEach((item, index) => {
    const key = getKey(item, index);
    set.add(key || 'row-' + index);
  });
  return set.size;
}
function compareValues(a, b, asc) {
  const va = a == null ? '' : a;
  const vb = b == null ? '' : b;
  if (typeof va === 'number' && typeof vb === 'number') return asc ? va - vb : vb - va;
  return asc ? String(va).localeCompare(String(vb), 'ja') : String(vb).localeCompare(String(va), 'ja');
}
function sourceBadge(source) {
  return `<span class="source-badge">${esc(fmtSource(source))}</span>`;
}
function pillList(items) {
  if (!items.length) return '<span class="pill muted">なし</span>';
  return items.map(item => `<span class="pill">${esc(item)}</span>`).join(' ');
}
function getGuestFunnel(guest) {
  const funnel = guest.funnel || {};
  return {
    guestStart: !!(guest.startedAt || funnel.guestStartAt || funnel.guestStartedAt),
    tutorialComplete: !!(guest.tutorialDone || funnel.tutorialCompleteAt || funnel.tutorialCompletedAt),
    firstTodoAdded: !!funnel.firstTodoAddedAt,
    firstTodoDone: !!funnel.firstTodoDoneAt,
    firstUnlock: !!funnel.firstUnlockAt
  };
}
function getGuestProgressCount(guest) {
  return Object.values(getGuestFunnel(guest)).filter(Boolean).length;
}
function renderProgress(guest) {
  const funnel = getGuestFunnel(guest);
  let highlighted = false;
  const badges = FUNNEL_STEPS.map(step => {
    const done = !!funnel[step.key];
    let cls = 'progress-badge';
    if (done) cls += ' done';
    else if (!highlighted) {
      cls += ' current';
      highlighted = true;
    }
    return `<span class="${cls}">${step.label}</span>`;
  }).join(' ');
  return `<div class="progress-stack">${badges}</div><span class="mini-sub">${getGuestProgressCount(guest)}/${FUNNEL_STEPS.length} ステップ</span>`;
}
function cellText(value) {
  const text = String(value || '').trim();
  return text ? `<div class="feedback-cell">${esc(text)}</div>` : '<div class="feedback-cell empty">-</div>';
}
function syncSortIndicators() {
  document.querySelectorAll('#user-table th').forEach(th => th.classList.toggle('sorted', th.dataset.sort === userSortKey));
  document.querySelectorAll('#guest-table th').forEach(th => th.classList.toggle('sorted', th.dataset.sort === guestSortKey));
  document.querySelectorAll('#feedback-table th').forEach(th => th.classList.toggle('sorted', th.dataset.sort === feedbackSortKey));
}
function buildMetrics() {
  const lpCta = uniqueCount(allEvents.filter(event => event.type === 'lp_cta_click'), event => event.sessionId || event.id);
  const guestStartEvents = uniqueCount(allEvents.filter(event => event.type === 'guest_start'), event => event.sessionId || event.guestId || event.id);
  const guestStart = Math.max(allGuests.length, guestStartEvents);
  const tutorialComplete = allGuests.filter(guest => getGuestFunnel(guest).tutorialComplete).length;
  const firstTodoAdded = allGuests.filter(guest => getGuestFunnel(guest).firstTodoAdded).length;
  const firstTodoDone = allGuests.filter(guest => getGuestFunnel(guest).firstTodoDone).length;
  const firstUnlock = allGuests.filter(guest => getGuestFunnel(guest).firstUnlock).length;
  const feedbackCount = allFeedback.length;
  return {
    lpCta,
    guestStart,
    tutorialComplete,
    firstTodoAdded,
    firstTodoDone,
    firstUnlock,
    feedbackCount,
    tutorialRate: guestStart ? Math.round((tutorialComplete / guestStart) * 100) : 0,
    unlockRate: guestStart ? Math.round((firstUnlock / guestStart) * 100) : 0,
    registeredUsers: allUsers.length
  };
}
function renderStats() {
  const metrics = buildMetrics();
  const cards = [
    { label: 'LP CTA', val: metrics.lpCta.toLocaleString(), sub: 'LP の CTA 押下数' },
    { label: 'ゲスト開始', val: metrics.guestStart.toLocaleString(), sub: 'guest_start と guests 件数の大きい方' },
    { label: 'チュートリアル完了率', val: metrics.tutorialRate + '%', sub: `${metrics.tutorialComplete}/${metrics.guestStart || 0} 人が完了` },
    { label: '初回解除率', val: metrics.unlockRate + '%', sub: `${metrics.firstUnlock}/${metrics.guestStart || 0} 人が到達` },
    { label: 'フィードバック数', val: metrics.feedbackCount.toLocaleString(), sub: 'feedback コレクション合計' },
    { label: '登録ユーザー数', val: metrics.registeredUsers.toLocaleString(), sub: 'users コレクション合計' }
  ];
  document.getElementById('stats-grid').innerHTML = cards.map(card => `
    <div class="stat-card">
      <div class="stat-label">${card.label}</div>
      <div class="stat-val">${card.val}</div>
      <div class="stat-sub">${card.sub}</div>
    </div>
  `).join('');
}
function renderBarChart(title, rows, colorClass) {
  if (!rows.length) {
    return `<div class="chart-card"><div class="chart-title">${title}</div><div class="chart-empty">まだデータがありません。</div></div>`;
  }
  const max = Math.max(1, ...rows.map(row => row.value));
  return `
    <div class="chart-card">
      <div class="chart-title">${title}</div>
      ${rows.map(row => `
        <div class="bar-row">
          <div class="bar-label">${esc(row.label)}</div>
          <div class="bar-wrap"><div class="bar-fill ${colorClass || ''}" style="width:${Math.round((row.value / max) * 100)}%"></div></div>
          <div class="bar-count">${row.value}</div>
        </div>
      `).join('')}
    </div>
  `;
}
function renderCharts() {
  const metrics = buildMetrics();
  const funnelRows = [
    { label: 'LP CTA', value: metrics.lpCta },
    { label: '開始', value: metrics.guestStart },
    { label: 'チュートリアル', value: metrics.tutorialComplete },
    { label: '追加', value: metrics.firstTodoAdded },
    { label: '完了', value: metrics.firstTodoDone },
    { label: '解除', value: metrics.firstUnlock }
  ];
  const sourceCounts = {};
  allGuests.forEach(guest => {
    const label = fmtSource(guest.source);
    sourceCounts[label] = (sourceCounts[label] || 0) + 1;
  });
  const sourceRows = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  const entCounts = {};
  allGuests.forEach(guest => {
    guest.unlockedEnts.forEach(name => { entCounts[name] = (entCounts[name] || 0) + 1; });
  });
  const entRows = Object.entries(entCounts).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  const rankCounts = {};
  allUsers.forEach(user => { rankCounts[user.rank.name] = (rankCounts[user.rank.name] || 0) + 1; });
  const rankRows = RANKS.map(rank => ({ label: rank.name, value: rankCounts[rank.name] || 0 }));
  document.getElementById('charts-grid').innerHTML = [
    renderBarChart('テスターファネル', funnelRows, 'green'),
    renderBarChart('ゲスト導線別の人数', sourceRows, 'blue'),
    renderBarChart('解除された娯楽', entRows, ''),
    renderBarChart('登録ユーザーのランク分布', rankRows, 'blue')
  ].join('');
}
function renderUserTable() {
  const sorted = [...allUsers].sort((a, b) => compareValues(a[userSortKey], b[userSortKey], userSortAsc));
  document.getElementById('user-count-label').textContent = `${sorted.length} 人`;
  document.getElementById('user-tbody').innerHTML = sorted.length ? sorted.map(user => {
    const isExpanded = expandedUsers.has(user.uid);
    const row = `
      <tr>
        <td><strong>${esc(user.displayName)}</strong><span class="mini-sub mono">${esc(user.uid)}</span></td>
        <td>${esc(user.job)}</td>
        <td><span class="rank-badge ${user.rank.cls}">${user.rank.name}</span></td>
        <td><strong style="color:var(--accent);">${user.totalEarned.toLocaleString()} LC</strong><span class="mini-sub">今日 +${user.todayEarned.toLocaleString()}</span></td>
        <td>${user.coins.toLocaleString()} LC</td>
        <td>${user.streak ? user.streak + '日' : '<span class="muted">0日</span>'}</td>
        <td>${user.todoDone}/${user.todoTotal}</td>
        <td>${pillList(user.activeEnts)}</td>
        <td><button class="inline-btn" onclick="toggleUserExpand('${user.uid}')">${isExpanded ? '閉じる' : '詳細'}</button></td>
      </tr>`;
    if (!isExpanded) return row;
    const todoItems = user.todos.length
      ? user.todos.map(todo => `<div class="detail-item"><span>${todo.done ? '✅' : '・'} ${esc(todo.text)}</span><span>${safeNum(todo.reward)} LC</span></div>`).join('')
      : '<div class="muted">タスクはまだありません。</div>';
    const historyItems = user.history.length
      ? user.history.slice().reverse().slice(0, 12).map(item => `<div class="detail-item"><span>${item.type === 'plus' ? '+' : '-'}${safeNum(item.amount)} LC ${esc(item.desc)}</span><span class="muted">${esc(item.time)}</span></div>`).join('')
      : '<div class="muted">履歴はまだありません。</div>';
    return row + `
      <tr class="detail-row">
        <td colspan="9">
          <div class="detail-inner">
            <div class="detail-grid">
              <div class="detail-card">
                <h4>タスク一覧</h4>
                <div class="detail-list">${todoItems}</div>
              </div>
              <div class="detail-card">
                <h4>コイン履歴</h4>
                <div class="detail-list">${historyItems}</div>
              </div>
            </div>
            <div class="mini-sub" style="margin-top:12px;">
              最終日付: ${esc(user.lastDate || '未記録')} / チュートリアル: ${user.tutorialDone ? '完了' : '未完了'} / Focus Week: ${user.focusWeekActive ? 'ON' : 'OFF'}
            </div>
          </div>
        </td>
      </tr>`;
  }).join('') : '<tr class="empty-row"><td colspan="9">登録ユーザーはまだいません。</td></tr>';
}
function renderGuestTable() {
  const sorted = [...allGuests].sort((a, b) => {
    const left = guestSortKey === 'progress' ? getGuestProgressCount(a) : a[guestSortKey];
    const right = guestSortKey === 'progress' ? getGuestProgressCount(b) : b[guestSortKey];
    return compareValues(left, right, guestSortAsc);
  });
  document.getElementById('guest-count-label').textContent = `${sorted.length} 人`;
  document.getElementById('guest-tbody').innerHTML = sorted.length ? sorted.map(guest => `
    <tr>
      <td>${esc(guest.job)}</td>
      <td>${guest.age ? guest.age + '歳' : '<span class="muted">任意</span>'}</td>
      <td>${sourceBadge(guest.source)}<span class="mini-sub mono">${esc(guest.sessionId || '-')}</span></td>
      <td><strong style="color:var(--accent);">${guest.totalEarned.toLocaleString()} LC</strong><span class="mini-sub">残高 ${guest.coins.toLocaleString()} LC</span></td>
      <td>${guest.todosDone}/${guest.todosTotal}</td>
      <td>${guest.streak ? guest.streak + '日' : '<span class="muted">0日</span>'}</td>
      <td>${pillList(guest.unlockedEnts)}</td>
      <td>${renderProgress(guest)}</td>
      <td>${shortDate(guest.lastActive)}</td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="9">ゲストデータはまだありません。</td></tr>';
}
function renderFeedbackTable() {
  const sorted = [...allFeedback].sort((a, b) => compareValues(a[feedbackSortKey], b[feedbackSortKey], feedbackSortAsc));
  const recent = sorted.slice(0, 50);
  document.getElementById('feedback-count-label').textContent = `${allFeedback.length} 件 / 最新 50 件を表示`;
  document.getElementById('feedback-tbody').innerHTML = recent.length ? recent.map(item => `
    <tr>
      <td>${fmtDate(item.createdAt)}</td>
      <td>${sourceBadge(item.source)}</td>
      <td class="mono">${esc(item.sessionId || '-')}</td>
      <td class="mono">${esc(item.guestId || '-')}</td>
      <td>${cellText(item.confusing)}</td>
      <td>${cellText(item.bugs)}</td>
      <td>${cellText(item.reason)}</td>
      <td>${cellText(item.wishlist)}</td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="8">まだフィードバックは届いていません。</td></tr>';
}
function renderAll() {
  renderStats();
  renderCharts();
  renderUserTable();
  renderGuestTable();
  renderFeedbackTable();
  syncSortIndicators();
}
function sortUsers(key) {
  if (userSortKey === key) userSortAsc = !userSortAsc;
  else { userSortKey = key; userSortAsc = false; }
  renderUserTable();
  syncSortIndicators();
}
function sortGuests(key) {
  if (guestSortKey === key) guestSortAsc = !guestSortAsc;
  else { guestSortKey = key; guestSortAsc = false; }
  renderGuestTable();
  syncSortIndicators();
}
function sortFeedback(key) {
  if (feedbackSortKey === key) feedbackSortAsc = !feedbackSortAsc;
  else { feedbackSortKey = key; feedbackSortAsc = false; }
  renderFeedbackTable();
  syncSortIndicators();
}
function toggleUserExpand(uid) {
  if (expandedUsers.has(uid)) expandedUsers.delete(uid);
  else expandedUsers.add(uid);
  renderUserTable();
  syncSortIndicators();
}
window.sortUsers = sortUsers;
window.sortGuests = sortGuests;
window.sortFeedback = sortFeedback;
window.toggleUserExpand = toggleUserExpand;

function setLoading(show) {
  document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}
function showErr(message) {
  const el = document.getElementById('err-box');
  el.style.display = 'block';
  el.innerHTML = message.replace(/\n/g, '<br>') + `
    <details style="margin-top:12px;">
      <summary style="cursor:pointer;color:var(--accent);font-weight:800;">Firestore ルール例</summary>
      <pre style="margin-top:8px;background:#0b111a;padding:12px;border-radius:12px;border:1px solid var(--line);overflow:auto;color:#b9c8dd;font-size:11px;">rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null
        && (request.auth.uid == userId
          || request.auth.token.email == '${ADMIN_EMAIL}');
    }
    match /guests/{guestId} {
      allow create, update: if true;
      allow read: if request.auth != null
        && request.auth.token.email == '${ADMIN_EMAIL}';
    }
    match /testerEvents/{eventId} {
      allow create: if true;
      allow read: if request.auth != null
        && request.auth.token.email == '${ADMIN_EMAIL}';
    }
    match /feedback/{feedbackId} {
      allow create: if true;
      allow read: if request.auth != null
        && request.auth.token.email == '${ADMIN_EMAIL}';
    }
  }
}</pre>
      <div class="mini-sub">Firebase Console の Firestore Rules に反映してください。</div>
    </details>`;
}
async function loadData() {
  setLoading(true);
  document.getElementById('err-box').style.display = 'none';
  try {
    const [userSnap, guestSnap, eventSnap, feedbackSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('guests').get(),
      db.collection('testerEvents').get(),
      db.collection('feedback').get()
    ]);

    allUsers = userSnap.docs.map(doc => {
      const data = doc.data() || {};
      const todos = Array.isArray(data.todos) ? data.todos : [];
      const access = data.access || {};
      const now = Date.now();
      const activeEnts = Object.entries(access)
        .filter(([, until]) => safeNum(until) > now)
        .map(([key]) => ENT_NAMES[key] || key);
      const rank = getRank(safeNum(data.totalEarned));
      return {
        uid: doc.id,
        displayName: data.displayName || '未設定',
        job: data.job || '未入力',
        coins: safeNum(data.coins),
        totalEarned: safeNum(data.totalEarned),
        todayEarned: safeNum(data.todayEarned),
        streak: safeNum(data.streak),
        todoTotal: todos.length,
        todoDone: todos.filter(todo => todo && todo.done).length,
        todos,
        history: Array.isArray(data.history) ? data.history : [],
        activeEnts,
        access,
        rank,
        rankOrder: rank.order,
        focusWeekActive: !!data.focusWeekActive,
        tutorialDone: !!data.tutorialDone,
        lastDate: data.lastDate || ''
      };
    });

    allGuests = guestSnap.docs.map(doc => {
      const data = doc.data() || {};
      const todos = Array.isArray(data.todos) ? data.todos : [];
      const access = data.access || {};
      const unlockedKeys = new Set([
        ...(Array.isArray(data.entertainmentsUnlocked) ? data.entertainmentsUnlocked : []),
        ...Object.keys(access).filter(key => !!access[key])
      ]);
      const todosDone = data.todosDone != null ? safeNum(data.todosDone) : todos.filter(todo => todo && todo.done).length;
      const todosTotal = data.todosTotal != null ? safeNum(data.todosTotal) : todos.length;
      return {
        id: doc.id,
        age: safeNum(data.age),
        job: data.job || '未入力',
        source: data.source || 'unknown',
        sessionId: data.sessionId || '',
        coins: safeNum(data.coins),
        totalEarned: safeNum(data.totalEarned),
        streak: safeNum(data.streak),
        todosDone,
        todosTotal,
        tutorialDone: !!data.tutorialDone,
        funnel: data.funnel || {},
        startedAt: safeNum(data.startedAt),
        lastActive: safeNum(data.lastActive || data.updatedAt || data.startedAt),
        unlockedEnts: Array.from(unlockedKeys).map(key => ENT_NAMES[key] || key)
      };
    });

    allEvents = eventSnap.docs.map(doc => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        type: data.type || 'unknown',
        source: data.source || 'unknown',
        sessionId: data.sessionId || '',
        guestId: data.guestId || null,
        createdAt: safeNum(data.createdAt)
      };
    });

    allFeedback = feedbackSnap.docs.map(doc => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        source: data.source || 'unknown',
        sessionId: data.sessionId || '',
        guestId: data.guestId || '',
        confusing: data.confusing || '',
        bugs: data.bugs || '',
        reason: data.reason || '',
        wishlist: data.wishlist || '',
        createdAt: safeNum(data.createdAt)
      };
    });

    renderAll();
  } catch (error) {
    showErr(
      error.code === 'permission-denied'
        ? 'Firestore の権限エラーです。下のルール例を反映してください。\n\n' + error.message
        : '読み込みエラー: ' + error.message
    );
  } finally {
    setLoading(false);
  }
}
window.loadData = loadData;

auth.onAuthStateChanged(user => {
  if (!user) {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
    return;
  }
  if (ADMIN_EMAIL !== 'YOUR_EMAIL@example.com' && user.email !== ADMIN_EMAIL) {
    auth.signOut();
    showAuthErr('管理者として許可されたアカウントではありません');
    return;
  }
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('admin-email-disp').textContent = user.email || ADMIN_EMAIL;
  loadData();
});

async function doLogin() {
  const email = document.getElementById('email').value.trim();
  const pass = document.getElementById('pass').value;
  if (!email || !pass) {
    showAuthErr('メールアドレスとパスワードを入力してください');
    return;
  }
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (error) {
    showAuthErr('ログインに失敗しました: ' + (error.code === 'auth/invalid-credential' ? '認証情報が正しくありません' : error.message));
  }
}
function doLogout() {
  auth.signOut();
}
function showAuthErr(message) {
  document.getElementById('auth-err').textContent = message;
}
window.doLogin = doLogin;
window.doLogout = doLogout;
document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && document.getElementById('auth-screen').style.display !== 'none') {
    doLogin();
  }
});

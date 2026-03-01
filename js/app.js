/**
 * Alpine.js Dashboard Application
 *
 * Status logic (via GitHub labels):
 *   closed issue               → Done
 *   open + inProgressLabel     → In Progress
 *   open + no status label     → Todo
 *
 * Drag-and-drop:
 *   Todo → In Progress   : adds inProgressLabel
 *   In Progress → Todo   : removes inProgressLabel
 *   any → Done           : closes issue
 *   Done → Todo/Progress : re-opens issue (and removes label if needed)
 */
function dashboard() {
  return {

    // ─── Auth ─────────────────────────────────────────────────────────────────

    token: localStorage.getItem('gh_token') || '',
    user: null,
    isAuthenticated: false,

    // ─── Loading / Notifications ──────────────────────────────────────────────

    isLoading: false,
    loadingMessage: '',
    notifications: [],
    _notifId: 0,

    // ─── Setup flow ───────────────────────────────────────────────────────────

    setupStep: 'token', // 'token' | 'repos' | 'dashboard'

    // ─── Repos ────────────────────────────────────────────────────────────────

    trackedRepos: JSON.parse(localStorage.getItem('tracked_repos') || '[]'),
    userRepos: [],
    repoSearch: '',
    newRepoInput: '',

    // ─── Data ─────────────────────────────────────────────────────────────────

    issues: [],
    pulls: [],
    labels: {},        // { 'owner/repo': [label, ...] }
    milestones: {},    // { 'owner/repo': [milestone, ...] }
    lastRefreshed: null,

    // ─── Filters / UI ─────────────────────────────────────────────────────────

    activeRepo: 'all',
    searchQuery: '',
    filterLabel: '',
    activeTab: 'overview',

    // ─── Settings ─────────────────────────────────────────────────────────────

    showSettings: false,
    inProgressLabel: localStorage.getItem('in_progress_label') || 'in-progress',
    doneLimit: 30,

    // ─── New Issue ────────────────────────────────────────────────────────────

    showNewIssue: false,
    newIssue: { repo: '', title: '', body: '' },

    // ─── Modal ────────────────────────────────────────────────────────────────

    showModal: false,
    modal: null,

    // ─── Drag & Drop ──────────────────────────────────────────────────────────

    dragItem: null,

    // ─── API ──────────────────────────────────────────────────────────────────

    api: null,

    // =========================================================================
    // INIT
    // =========================================================================

    async init() {
      if (this.token) await this.authenticate();
    },

    // =========================================================================
    // AUTH
    // =========================================================================

    async authenticate() {
      if (!this.token.trim()) return;
      this.isLoading = true;
      this.loadingMessage = '驗證 GitHub Token…';

      try {
        this.api = new GitHubAPI(this.token.trim());
        this.user = await this.api.getUser();
        this.isAuthenticated = true;
        localStorage.setItem('gh_token', this.token.trim());

        if (this.trackedRepos.length > 0) {
          this.setupStep = 'dashboard';
          await this.loadAllData();
        } else {
          this.setupStep = 'repos';
          await this.loadUserRepos();
        }
      } catch (e) {
        this.notify('Token 驗證失敗：' + e.message, 'error');
        this.isAuthenticated = false;
        this.api = null;
      } finally {
        this.isLoading = false;
      }
    },

    logout() {
      localStorage.removeItem('gh_token');
      localStorage.removeItem('tracked_repos');
      this.token = '';
      this.isAuthenticated = false;
      this.user = null;
      this.setupStep = 'token';
      this.trackedRepos = [];
      this.issues = [];
      this.pulls = [];
    },

    // =========================================================================
    // REPO MANAGEMENT
    // =========================================================================

    async loadUserRepos() {
      this.loadingMessage = '載入您的 repositories…';
      try {
        this.userRepos = await this.api.getUserRepos();
      } catch (e) {
        this.notify('無法載入 repos：' + e.message, 'error');
      }
    },

    get filteredUserRepos() {
      if (!this.repoSearch) return this.userRepos;
      const q = this.repoSearch.toLowerCase();
      return this.userRepos.filter(r => r.full_name.toLowerCase().includes(q));
    },

    isTracked(fullName) {
      return this.trackedRepos.includes(fullName);
    },

    toggleRepo(fullName) {
      const idx = this.trackedRepos.indexOf(fullName);
      if (idx >= 0) this.trackedRepos.splice(idx, 1);
      else this.trackedRepos.push(fullName);
      localStorage.setItem('tracked_repos', JSON.stringify(this.trackedRepos));
    },

    async addCustomRepo() {
      const name = this.newRepoInput.trim();
      if (!name) return;
      if (!name.includes('/')) {
        this.notify('格式應為 owner/repo', 'error'); return;
      }
      if (!this.trackedRepos.includes(name)) {
        this.trackedRepos.push(name);
        localStorage.setItem('tracked_repos', JSON.stringify(this.trackedRepos));
        this.notify(`已加入 ${name}`, 'success');
      }
      this.newRepoInput = '';
    },

    async syncAllRepos() {
      this.isLoading = true;
      this.loadingMessage = '同步所有 GitHub repos…';
      try {
        const repos = await this.api.getAllUserRepos();
        let added = 0;
        for (const repo of repos) {
          if (!this.trackedRepos.includes(repo.full_name)) {
            this.trackedRepos.push(repo.full_name);
            added++;
          }
        }
        localStorage.setItem('tracked_repos', JSON.stringify(this.trackedRepos));
        if (added > 0) {
          this.notify(`已加入 ${added} 個新 repos`, 'success');
          await this.loadAllData();
        } else {
          this.notify('沒有新的 repos', 'info');
        }
      } catch (e) {
        this.notify('同步失敗：' + e.message, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    removeRepo(fullName) {
      const idx = this.trackedRepos.indexOf(fullName);
      if (idx >= 0) {
        this.trackedRepos.splice(idx, 1);
        localStorage.setItem('tracked_repos', JSON.stringify(this.trackedRepos));
        this.issues = this.issues.filter(i => i.repoFullName !== fullName);
        this.pulls = this.pulls.filter(p => p.repoFullName !== fullName);
        if (this.activeRepo === fullName) this.activeRepo = 'all';
      }
    },

    async startDashboard() {
      if (this.trackedRepos.length === 0) {
        this.notify('請至少選擇一個 repository', 'error'); return;
      }
      this.setupStep = 'dashboard';
      await this.loadAllData();
    },

    // =========================================================================
    // DATA LOADING
    // =========================================================================

    async loadAllData() {
      this.isLoading = true;
      this.issues = [];
      this.pulls = [];

      const repos = this.activeRepo === 'all'
        ? this.trackedRepos
        : [this.activeRepo];

      try {
        for (const fullName of repos) {
          const [owner, repo] = fullName.split('/');
          this.loadingMessage = `載入 ${fullName}…`;

          const [rawIssues, rawPulls, repoLabels, repoMilestones] = await Promise.all([
            this.api.getRepoIssues(owner, repo),
            this.api.getRepoPulls(owner, repo),
            this.api.getLabels(owner, repo),
            this.api.getMilestones(owner, repo)
          ]);

          this.labels[fullName] = repoLabels;
          this.milestones[fullName] = repoMilestones;

          // Filter out PRs from issues endpoint
          const issueItems = rawIssues
            .filter(i => !i.pull_request)
            .map(i => ({ ...i, repoFullName: fullName, owner, repo }));

          const prItems = rawPulls
            .map(p => ({ ...p, repoFullName: fullName, owner, repo }));

          this.issues.push(...issueItems);
          this.pulls.push(...prItems);
        }

        this.lastRefreshed = new Date();
      } catch (e) {
        this.notify('載入失敗：' + e.message, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    async refresh() {
      await this.loadAllData();
      this.notify('資料已更新', 'success');
    },

    // =========================================================================
    // COMPUTED — Issues
    // =========================================================================

    get baseIssues() {
      let list = this.activeRepo === 'all'
        ? this.issues
        : this.issues.filter(i => i.repoFullName === this.activeRepo);

      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        list = list.filter(i =>
          i.title.toLowerCase().includes(q) ||
          String(i.number).includes(q) ||
          i.repoFullName.toLowerCase().includes(q)
        );
      }

      if (this.filterLabel) {
        list = list.filter(i => i.labels.some(l => l.name === this.filterLabel));
      }

      return list;
    },

    _isInProgress(issue) {
      return issue.labels.some(l =>
        l.name.toLowerCase() === this.inProgressLabel.toLowerCase()
      );
    },

    get todoIssues() {
      return this.baseIssues.filter(i => i.state === 'open' && !this._isInProgress(i));
    },

    get inProgressIssues() {
      return this.baseIssues.filter(i => i.state === 'open' && this._isInProgress(i));
    },

    get doneIssues() {
      return this.baseIssues
        .filter(i => i.state === 'closed')
        .slice(0, this.doneLimit);
    },

    get doneTotalCount() {
      return this.baseIssues.filter(i => i.state === 'closed').length;
    },

    // =========================================================================
    // COMPUTED — PRs
    // =========================================================================

    get filteredPulls() {
      let list = this.activeRepo === 'all'
        ? this.pulls
        : this.pulls.filter(p => p.repoFullName === this.activeRepo);

      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        list = list.filter(p =>
          p.title.toLowerCase().includes(q) ||
          String(p.number).includes(q)
        );
      }

      return list;
    },

    get openPulls()   { return this.filteredPulls.filter(p => p.state === 'open' && !p.draft); },
    get draftPulls()  { return this.filteredPulls.filter(p => p.draft); },
    get mergedPulls() { return this.filteredPulls.filter(p => p.merged_at); },
    get closedPulls() { return this.filteredPulls.filter(p => p.state === 'closed' && !p.merged_at); },

    // =========================================================================
    // COMPUTED — Stats
    // =========================================================================

    get stats() {
      const base = this.activeRepo === 'all' ? this.issues : this.issues.filter(i => i.repoFullName === this.activeRepo);
      const pbase = this.activeRepo === 'all' ? this.pulls : this.pulls.filter(p => p.repoFullName === this.activeRepo);

      const open = base.filter(i => i.state === 'open').length;
      const closed = base.filter(i => i.state === 'closed').length;
      const total = base.length;
      const inProgress = base.filter(i => i.state === 'open' && this._isInProgress(i)).length;
      const openPRs = pbase.filter(p => p.state === 'open').length;
      const mergedPRs = pbase.filter(p => p.merged_at).length;
      const progress = total > 0 ? Math.round(closed / total * 100) : 0;

      return { open, closed, total, inProgress, openPRs, mergedPRs, progress };
    },

    get repoStats() {
      return this.trackedRepos.map(fullName => {
        const ri = this.issues.filter(i => i.repoFullName === fullName);
        const rp = this.pulls.filter(p => p.repoFullName === fullName);
        const open = ri.filter(i => i.state === 'open').length;
        const closed = ri.filter(i => i.state === 'closed').length;
        const total = ri.length;
        const progress = total > 0 ? Math.round(closed / total * 100) : 0;
        return {
          fullName,
          shortName: fullName.split('/')[1],
          open, closed, total, progress,
          openPRs: rp.filter(p => p.state === 'open').length,
        };
      });
    },

    get allLabels() {
      const set = new Set();
      this.issues.forEach(i => i.labels.forEach(l => set.add(l.name)));
      return [...set].sort();
    },

    // =========================================================================
    // MODAL
    // =========================================================================

    openModal(item) {
      this.modal = {
        ...item,
        _title: item.title,
        _body: item.body || '',
        _state: item.state,
        _labels: item.labels.map(l => ({ ...l })),
        _milestoneNum: item.milestone ? String(item.milestone.number) : '',
      };
      this.showModal = true;
    },

    closeModal() {
      this.showModal = false;
      this.modal = null;
    },

    modalToggleLabel(label) {
      const idx = this.modal._labels.findIndex(l => l.name === label.name);
      if (idx >= 0) this.modal._labels.splice(idx, 1);
      else this.modal._labels.push({ ...label });
    },

    modalHasLabel(labelName) {
      return this.modal._labels.some(l => l.name === labelName);
    },

    async saveModal() {
      if (!this.modal) return;
      const { owner, repo, number, repoFullName } = this.modal;

      this.isLoading = true;
      this.loadingMessage = '儲存中…';

      try {
        const updated = await this.api.updateIssue(owner, repo, number, {
          title: this.modal._title,
          body: this.modal._body,
          state: this.modal._state,
          labels: this.modal._labels.map(l => l.name),
          milestone: this.modal._milestoneNum ? parseInt(this.modal._milestoneNum) : null,
        });

        const idx = this.issues.findIndex(
          i => i.repoFullName === repoFullName && i.number === number
        );
        if (idx >= 0) {
          this.issues[idx] = { ...updated, repoFullName, owner, repo };
        }

        this.notify('已儲存', 'success');
        this.closeModal();
      } catch (e) {
        this.notify('儲存失敗：' + e.message, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    // =========================================================================
    // NEW ISSUE
    // =========================================================================

    async submitNewIssue() {
      const { repo: fullName, title, body } = this.newIssue;
      if (!fullName || !title) { this.notify('請填寫 repo 和標題', 'error'); return; }

      const [owner, repo] = fullName.split('/');
      this.isLoading = true;
      this.loadingMessage = '建立 Issue…';

      try {
        const created = await this.api.createIssue(owner, repo, { title, body });
        this.issues.unshift({ ...created, repoFullName: fullName, owner, repo });
        this.notify(`Issue #${created.number} 已建立`, 'success');
        this.showNewIssue = false;
        this.newIssue = { repo: '', title: '', body: '' };
      } catch (e) {
        this.notify('建立失敗：' + e.message, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    // =========================================================================
    // DRAG & DROP (Kanban)
    // =========================================================================

    onDragStart(item) {
      this.dragItem = item;
    },

    onDragOver(e) {
      e.preventDefault();
    },

    async onDrop(targetColumn) {
      if (!this.dragItem) return;
      const item = this.dragItem;
      this.dragItem = null;

      const { owner, repo, number, repoFullName } = item;
      const currentState = item.state;
      const currentInProgress = this._isInProgress(item);

      // Determine what needs to change
      let newState = currentState;
      let addLabel = null;
      let removeLabel = null;

      if (targetColumn === 'todo') {
        newState = 'open';
        if (currentInProgress) removeLabel = this.inProgressLabel;
      } else if (targetColumn === 'inprogress') {
        newState = 'open';
        if (!currentInProgress) addLabel = this.inProgressLabel;
      } else if (targetColumn === 'done') {
        newState = 'closed';
        if (currentInProgress) removeLabel = this.inProgressLabel;
      }

      // No change needed
      if (newState === currentState && !addLabel && !removeLabel) return;

      this.isLoading = true;
      this.loadingMessage = '更新中…';

      try {
        // Update state + base labels
        const currentLabels = item.labels.map(l => l.name);

        // Build new label list
        let newLabels = [...currentLabels];
        if (removeLabel) newLabels = newLabels.filter(n => n.toLowerCase() !== removeLabel.toLowerCase());
        if (addLabel && !newLabels.some(n => n.toLowerCase() === addLabel.toLowerCase())) {
          // Ensure the label exists in the repo, otherwise skip
          const repoLabels = this.labels[repoFullName] || [];
          const found = repoLabels.find(l => l.name.toLowerCase() === addLabel.toLowerCase());
          if (found) newLabels.push(found.name);
          else this.notify(`標籤 "${addLabel}" 不存在，請先在 GitHub 建立它`, 'error');
        }

        const updated = await this.api.updateIssue(owner, repo, number, {
          state: newState,
          labels: newLabels,
        });

        const idx = this.issues.findIndex(
          i => i.repoFullName === repoFullName && i.number === number
        );
        if (idx >= 0) {
          this.issues[idx] = { ...updated, repoFullName, owner, repo };
        }
      } catch (e) {
        this.notify('更新失敗：' + e.message, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    // =========================================================================
    // SETTINGS
    // =========================================================================

    saveSettings() {
      localStorage.setItem('in_progress_label', this.inProgressLabel);
      this.showSettings = false;
      this.notify('設定已儲存', 'success');
    },

    // =========================================================================
    // NOTIFICATIONS
    // =========================================================================

    notify(msg, type = 'info') {
      const id = ++this._notifId;
      this.notifications.push({ id, msg, type });
      setTimeout(() => {
        this.notifications = this.notifications.filter(n => n.id !== id);
      }, 4000);
    },

    // =========================================================================
    // UTILITY
    // =========================================================================

    timeAgo(dateStr) {
      if (!dateStr) return '';
      const diff = Date.now() - new Date(dateStr).getTime();
      const m = Math.floor(diff / 60000);
      const h = Math.floor(diff / 3600000);
      const d = Math.floor(diff / 86400000);
      if (d > 30) return `${Math.floor(d / 30)} 個月前`;
      if (d > 0)  return `${d} 天前`;
      if (h > 0)  return `${h} 小時前`;
      if (m > 0)  return `${m} 分鐘前`;
      return '剛剛';
    },

    labelStyle(hexColor) {
      if (!hexColor) return {};
      const r = parseInt(hexColor.slice(0, 2), 16);
      const g = parseInt(hexColor.slice(2, 4), 16);
      const b = parseInt(hexColor.slice(4, 6), 16);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return {
        backgroundColor: `#${hexColor}40`,
        color: luminance > 0.5 ? `#${hexColor}` : `#${hexColor}`,
        border: `1px solid #${hexColor}80`,
      };
    },

    prStateColor(pr) {
      if (pr.merged_at) return 'text-purple-400 bg-purple-400/10 border-purple-400/30';
      if (pr.draft)     return 'text-gray-400 bg-gray-400/10 border-gray-400/30';
      if (pr.state === 'closed') return 'text-red-400 bg-red-400/10 border-red-400/30';
      return 'text-green-400 bg-green-400/10 border-green-400/30';
    },

    prStateLabel(pr) {
      if (pr.merged_at)          return 'Merged';
      if (pr.draft)              return 'Draft';
      if (pr.state === 'closed') return 'Closed';
      return 'Open';
    },

    get refreshedLabel() {
      if (!this.lastRefreshed) return '未載入';
      return this.timeAgo(this.lastRefreshed);
    },
  };
}

/**
 * GitHub REST API v3 Wrapper
 * Handles all communication with the GitHub API.
 */
class GitHubAPI {
  constructor(token) {
    this.token = token;
    this.base = 'https://api.github.com';
  }

  async req(path, opts = {}) {
    const res = await fetch(this.base + path, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      }
    });

    if (res.status === 204) return null;

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}: ${res.statusText}`);
    }

    return res.json();
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  getUser() {
    return this.req('/user');
  }

  getUserRepos() {
    // Returns repos the user owns or collaborates on, sorted by recent update
    return this.req('/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator');
  }

  // ─── Paginated Fetcher ─────────────────────────────────────────────────────

  async getAllPages(path) {
    const all = [];
    let page = 1;
    const sep = path.includes('?') ? '&' : '?';

    while (page <= 15) { // max 15 pages = 1500 items safety limit
      const data = await this.req(`${path}${sep}per_page=100&page=${page}`);
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < 100) break;
      page++;
    }

    return all;
  }

  // ─── Issues ───────────────────────────────────────────────────────────────

  getRepoIssues(owner, repo) {
    // GitHub issues endpoint includes PRs — filter them out in app
    return this.getAllPages(`/repos/${owner}/${repo}/issues?state=all`);
  }

  updateIssue(owner, repo, number, data) {
    return this.req(`/repos/${owner}/${repo}/issues/${number}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  createIssue(owner, repo, data) {
    return this.req(`/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // ─── Labels ───────────────────────────────────────────────────────────────

  getLabels(owner, repo) {
    return this.req(`/repos/${owner}/${repo}/labels?per_page=100`);
  }

  addLabels(owner, repo, number, labels) {
    return this.req(`/repos/${owner}/${repo}/issues/${number}/labels`, {
      method: 'POST',
      body: JSON.stringify({ labels })
    });
  }

  removeLabel(owner, repo, number, label) {
    return this.req(
      `/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`,
      { method: 'DELETE' }
    );
  }

  // ─── Milestones ───────────────────────────────────────────────────────────

  getMilestones(owner, repo) {
    return this.req(`/repos/${owner}/${repo}/milestones?state=all&per_page=100`);
  }

  // ─── Pull Requests ────────────────────────────────────────────────────────

  getRepoPulls(owner, repo) {
    return this.getAllPages(`/repos/${owner}/${repo}/pulls?state=all`);
  }
}

/**
 * 角色资源同步报告窗口。
 * 独立深色应用，不挂 xjzl-window 类：该类的 .window-content 是角色卡专用三栏网格，
 * 会把报告内容压进侧栏列并锁死滚动。
 * @param {object} options.report - runResourceSync 返回的报告数据
 */
export class XJZLResourceSyncReport extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  /** 统计块与角色徽章的固定展示顺序。 */
  static STATUS_ORDER = ["updated", "unchanged", "unmatched", "skipped", "failed", "recovered"];

  /** 各资源类型在列表行前的图标。 */
  static TYPE_ICONS = {
    neigong: "fa-yin-yang",
    wuxue: "fa-hand-fist",
    art_book: "fa-book-open",
    weapon: "fa-khanda",
    armor: "fa-shield-halved",
    qizhen: "fa-gem",
    consumable: "fa-flask",
    misc: "fa-box",
    trait: "fa-star"
  };

  static DEFAULT_OPTIONS = {
    tag: "div",
    id: "xjzl-resource-sync-report",
    classes: ["xjzl-resource-sync-report", "theme-dark"],
    window: {
      title: "XJZL.Settings.ResourceSync.Title",
      icon: "fas fa-arrows-rotate",
      width: 920,
      height: 720,
      resizable: true
    },
    position: { width: 920, height: 720 },
    actions: {
      export: XJZLResourceSyncReport.prototype._onExport,
      openActor: XJZLResourceSyncReport.prototype._onOpenActor,
      expandAll: XJZLResourceSyncReport.prototype._onExpandAll,
      collapseAll: XJZLResourceSyncReport.prototype._onCollapseAll
    }
  };

  static PARTS = {
    main: {
      template: "systems/xjzl-system/templates/apps/resource-sync-report.hbs",
      scrollable: [".xjzl-resource-sync-list"]
    }
  };

  constructor(options = {}) {
    super(options);
    this.report = options.report || {};
  }

  async _prepareContext() {
    const counts = this.report.counts || {};
    const cards = [
      ["scannedActors", "XJZL.Settings.ResourceSync.ScannedActors", "fa-users", this.report.scannedActors || 0],
      ["updated", "XJZL.Settings.ResourceSync.Updated", "fa-arrows-rotate", counts.updated || 0],
      ["unchanged", "XJZL.Settings.ResourceSync.Unchanged", "fa-circle-check", counts.unchanged || 0],
      ["unmatched", "XJZL.Settings.ResourceSync.Unmatched", "fa-circle-question", counts.unmatched || 0],
      ["skipped", "XJZL.Settings.ResourceSync.Skipped", "fa-forward", counts.skipped || 0],
      ["failed", "XJZL.Settings.ResourceSync.FailedCount", "fa-triangle-exclamation", (counts.failed || 0) + (counts.recovered || 0)]
    ].map(([key, label, icon, value]) => ({ key, label: game.i18n.localize(label), icon, value }));
    const statusLabels = {
      updated: game.i18n.localize("XJZL.Settings.ResourceSync.Updated"),
      unchanged: game.i18n.localize("XJZL.Settings.ResourceSync.Unchanged"),
      unmatched: game.i18n.localize("XJZL.Settings.ResourceSync.Unmatched"),
      skipped: game.i18n.localize("XJZL.Settings.ResourceSync.Skipped"),
      failed: game.i18n.localize("XJZL.Settings.ResourceSync.FailedCount"),
      recovered: game.i18n.localize("XJZL.Settings.ResourceSync.FailedRecovered")
    };
    const actors = (this.report.actors || []).map(actor => {
      const items = (actor.items || []).map(item => ({
        ...item,
        typeIcon: XJZLResourceSyncReport.TYPE_ICONS[item.type] || "fa-scroll"
      }));
      // 只有需要关注的结果才默认展开；全是“无需更新”的角色收起，长报告不至于一屏放不下。
      const attention = items.some(item => item.status !== "unchanged");
      return {
        ...actor,
        items,
        attention,
        open: attention,
        searchText: `${actor.name} ${items.map(item => item.name).join(" ")}`.toLowerCase(),
        chips: XJZLResourceSyncReport.STATUS_ORDER
          .filter(status => (actor.counts?.[status] || 0) > 0)
          .map(status => ({ status, count: actor.counts[status], label: statusLabels[status] }))
      };
    });
    return {
      ...this.report,
      cards,
      actors,
      generatedAtLabel: this.report.finishedAt ? game.i18n.format("XJZL.Settings.ResourceSync.FinishedAt", { time: new Date(this.report.finishedAt).toLocaleString() }) : ""
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const filter = this.element.querySelector(".xjzl-resource-sync-filter");
    const entries = [...this.element.querySelectorAll(".xjzl-rsync-actor")];
    filter?.addEventListener("input", () => {
      const query = filter.value.trim().toLowerCase();
      entries.forEach(entry => {
        entry.hidden = Boolean(query) && !entry.dataset.search.includes(query);
      });
    });
  }

  async _onOpenActor(event, target) {
    event.preventDefault();
    const actor = await fromUuid(target.dataset.uuid);
    if (actor?.sheet) actor.sheet.render(true);
  }

  _onExpandAll(event) {
    this.#setAllDetails(event, true);
  }

  _onCollapseAll(event) {
    this.#setAllDetails(event, false);
  }

  /** 直接切换 DOM 开合状态：不重渲染，避免清空筛选输入和滚动位置。 */
  #setAllDetails(event, open) {
    event.preventDefault();
    for (const details of this.element.querySelectorAll(".xjzl-rsync-actor")) {
      details.open = open;
    }
  }

  _onExport(event) {
    event.preventDefault();
    const payload = JSON.stringify(this.report, null, 2);
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `xjzl-resource-sync-${new Date().toISOString().replaceAll(":", "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
}

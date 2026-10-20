/**
 * 角色资源同步报告窗口。
 * @param {object} options.report - runResourceSync 返回的报告数据
 */
export class XJZLResourceSyncReport extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = {
    tag: "div",
    id: "xjzl-resource-sync-report",
    classes: ["xjzl-window", "xjzl-resource-sync-report", "theme-dark"],
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
      openActor: XJZLResourceSyncReport.prototype._onOpenActor
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
      ["updated", "XJZL.Settings.ResourceSync.Updated", "fa-check", counts.updated || 0],
      ["unchanged", "XJZL.Settings.ResourceSync.Unchanged", "fa-circle-check", counts.unchanged || 0],
      ["unmatched", "XJZL.Settings.ResourceSync.Unmatched", "fa-magnifying-glass-minus", counts.unmatched || 0],
      ["skipped", "XJZL.Settings.ResourceSync.Skipped", "fa-forward", counts.skipped || 0],
      ["failed", "XJZL.Settings.ResourceSync.FailedCount", "fa-triangle-exclamation", (counts.failed || 0) + (counts.recovered || 0)]
    ].map(([key, label, icon, value]) => ({ key, label: game.i18n.localize(label), icon, value }));
    const actors = (this.report.actors || []).map(actor => ({
      ...actor,
      searchText: `${actor.name} ${actor.items.map(item => item.name).join(" ")}`.toLowerCase(),
      summary: Object.entries(actor.counts || {}).map(([status, count]) => ({ status, count }))
    }));
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
    const entries = [...this.element.querySelectorAll(".xjzl-resource-sync-actor")];
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


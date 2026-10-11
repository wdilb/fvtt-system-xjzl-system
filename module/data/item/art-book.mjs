
import { XJZL } from "../../config.mjs"; // 导入配置，用于 choices
import { allocateBookXPToChapters } from "../../utils/art-book-xp.mjs";
// 不需要 makeScriptEffectSchema，因为技艺书的特效不自动化

/**
 * 技艺书籍 (Art Book) 数据模型
 * ==========================================
 * 核心职责：
 * 1. 定义技艺书的基本信息和章节列表。
 * 2. 管理投入的修为和计算每个章节的阅读进度。
 * 3. 汇总书本提供的技艺等级和检定加成。
 * ==========================================
 */
export class XJZLArtBookData extends foundry.abstract.TypeDataModel {

  /**
   * 旧结构兼容迁移（文档构造时执行，覆盖世界加载、JSON/合集导入等所有路径）。
   * 旧版修为存于书级总池 xpInvested，新版存于各章。转换幂等且收敛：
   * - 书级有余额且各章全空：按原顺序分配算法拆到各章（溢出并入首章，总额守恒）；
   * - 书级有余额但篇章已持有修为：书级字段只是残留旧值，仅清零（篇章为准）；
   * - 书级有余额但无篇章（旧版删光篇章后残留的总池）：有意保留在书级不动——
   *   聚合统计会计入它（见 prepareDerivedData），整书删除可返还，
   *   添加首章时按序折入新篇章（见 art-book-sheet 的 _onAddChapter）。
   * 转换结果直接进入 _source，toObject/update 等写路径看到的即是新结构；
   * 落库收敛由后续任意一次篇章写路径完成（invest/refund 均会同步清零书级字段）。
   */
  static migrateData(source) {
    source = super.migrateData(source);
    const investedTotal = source?.xpInvested || 0;
    if (investedTotal <= 0) return source;

    const chapters = Array.isArray(source.chapters) ? source.chapters : [];
    if (chapters.length > 0) {
      if (!chapters.some(c => (c?.xpInvested || 0) > 0)) {
        const { chapters: allocated } = allocateBookXPToChapters(chapters, investedTotal, source.sourceBreakdown);
        source.chapters = allocated;
      }
      // 篇章已持有修为（新结构+残留书级字段）时无需搬运，仅清书级
      source.xpInvested = 0;
      source.sourceBreakdown = { general: 0, specific: 0 };
    }
    return source;
  }

  static defineSchema() {
    const fields = foundry.data.fields;

    // [Helper] 章节结构定义 (Chapter Schema)
    const chapterSchema = new fields.SchemaField({
      // --- 1. 索引与标识 ---
      id: new fields.StringField({ required: true, initial: () => foundry.utils.randomID() }),
      name: new fields.StringField({ required: true, initial: "新篇章", label: "XJZL.ArtBook.ChapterName" }),
      img: new fields.StringField({ required: true, initial: "icons/svg/book.svg" }), // 章节图标

      // --- 2. 描述与要求 ---
      description: new fields.HTMLField({ label: "XJZL.ArtBook.ChapterDesc" }),

      // 修炼消耗 (填满这一篇章需要的 XP)
      cost: new fields.NumberField({
        required: true,
        min: 1,
        initial: 100,
        integer: true,
        label: "XJZL.ArtBook.ChapterCost"
      }),

      // 该章节的修炼消耗系数
      xpCostRatio: new fields.NumberField({
        required: true, initial: 1, min: 0,
        label: "XJZL.ArtBook.XPCostRatio"
      }),

      // 奖励 (读完这一篇给什么)
      reward: new fields.SchemaField({
        level: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.ArtBook.RewardLevel" }), // 技艺等级 +N
        check: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.ArtBook.RewardCheck" })  // 检定加值 +N
      }),

      // --- 3. 篇章独立修为 (可任选篇章投入，记录方式对齐武学招式) ---
      xpInvested: new fields.NumberField({
        min: 0,
        initial: 0,
        integer: true,
        label: "XJZL.ArtBook.XPInvested"
      }),

      // 该篇章的修为来源构成 (支持按篇精准回退)
      sourceBreakdown: new fields.SchemaField({
        general: new fields.NumberField({ initial: 0, min: 0, integer: true }), // 来自通用
        specific: new fields.NumberField({ initial: 0, min: 0, integer: true }) // 来自技艺专属
      })
    });

    return {
      // 是否官方资源标签
      isOfficial: new fields.BooleanField({
        initial: true,
        label: "XJZL.Item.IsOfficial"
      }),
      // === 技艺书总纲 ===

      // 1. 基本信息
      description: new fields.HTMLField({ label: "XJZL.Item.Description" }),
      img: new fields.StringField({ initial: "icons/svg/book.svg" }),

      // 2. 关联技艺 (必填，决定了加哪个技艺)
      artType: new fields.StringField({
        required: true,
        choices: Object.keys(XJZL.arts), // 只能选配置中定义的技艺类型
        initial: "duanzao",
        label: "XJZL.ArtBook.ArtType"
      }),

      // 3. 【衍生数据】修为投入 (各篇章求和)
      // 修为实际存储在各章的 xpInvested 上；此字段仅为兼容既有读取点
      // （书目列表、物品卡头部等）保留，由 prepareDerivedData 每次重算，不再落库
      xpInvested: new fields.NumberField({
        min: 0,
        initial: 0,
        integer: true,
        label: "XJZL.ArtBook.XPInvested"
      }),

      // 修为来源构成 (各篇章求和，同上为衍生值)
      sourceBreakdown: new fields.SchemaField({
        general: new fields.NumberField({ initial: 0, min: 0, integer: true }), // 来自通用
        specific: new fields.NumberField({ initial: 0, min: 0, integer: true }) // 来自技艺专属
      }),

      // 4. 章节列表
      chapters: new fields.ArrayField(chapterSchema, { label: "XJZL.ArtBook.Chapters" }),

      // 5. 【衍生数据】累计奖励 (不需要存库，每次计算)
      // 这些字段会在 prepareDerivedData 中动态计算并附加到 this.system 上
      // 用于 Actor 读取
      totalLevelBonus: new fields.NumberField({ initial: 0, integer: true, required: false }),
      totalCheckBonus: new fields.NumberField({ initial: 0, integer: true, required: false })
    };
  }

  /**
   * 衍生数据计算
   * 核心职责：
   * 1. 按各章独立的 xpInvested 计算阅读进度 (已读、阅读中、未读)，篇章可任选投入、互不依赖。
   * 2. 汇总所有已读篇章提供的技艺等级和检定加成。
   * 3. 将书级 xpInvested / sourceBreakdown 聚合为各章之和，维持既有读取点的展示兼容。
   */
  prepareDerivedData() {
    let totalXP = 0;
    let totalGeneral = 0;
    let totalSpecific = 0;
    let totalLevelReward = 0;
    let totalCheckReward = 0;

    // 遍历所有章节，各自独立计算进度和累积奖励
    for (const chapter of this.chapters) {
      // --- 计算实际消耗 ---
      const rawCost = chapter.cost || 0;
      const ratio = chapter.xpCostRatio ?? 1;

      // 这一章实际需要填的坑
      const chapterCost = Math.floor(rawCost * ratio);

      // 钳制展示值：正常投入路径不会超过上限，此处兜底 GM 手动调低消耗的情况
      const invested = Math.min(chapter.xpInvested || 0, chapterCost);
      const isCompleted = chapterCost > 0 ? invested >= chapterCost : true;

      // 进度条数据 (用于 UI 显示)
      chapter.progress = {
        current: invested,
        max: chapterCost,
        pct: chapterCost > 0 ? Math.min(100, Math.floor((invested / chapterCost) * 100)) : 100,
        isCompleted
      };

      if (isCompleted) {
        // 累积奖励 (与篇章顺序无关，投满即生效)
        totalLevelReward += (chapter.reward?.level || 0);
        totalCheckReward += (chapter.reward?.check || 0);
      }

      // 聚合书级总额用各章真实投入 (不钳制)：这是修为存量的真值，删除书籍返还、
      // 可取回金额都依赖它；GM 调低消耗或迁移溢出并入首章时它可能超过 maxXP，
      // 进度百分比处已单独钳制到 100%
      totalXP += chapter.xpInvested || 0;
      // 来源构成按章内存量累计 (不钳制)，保证删除书籍时按篇返还的总额不受影响
      totalGeneral += chapter.sourceBreakdown?.general || 0;
      totalSpecific += chapter.sourceBreakdown?.specific || 0;
    }

    // 空章节旧书的书级遗留池（migrateData 有意保留在书级）：无法按篇拆分但真实存在，
    // 计入总额与整书删除返还，避免"存储有值、界面与返还统计为 0"；
    // 来源构成缺失时按旧版删除流程的兜底约定全记通用
    if (this.chapters.length === 0) {
      const legacyPool = this._source?.xpInvested || 0;
      const legacyBreakdown = this._source?.sourceBreakdown;
      totalXP += legacyPool;
      totalGeneral += legacyBreakdown?.general ?? legacyPool;
      totalSpecific += legacyBreakdown?.specific ?? 0;
    }

    // 书级字段降级为聚合展示值 (读取点兼容)，真实数据在各章
    this.xpInvested = totalXP;
    this.sourceBreakdown = { general: totalGeneral, specific: totalSpecific };

    // 将累积的奖励存储为 Item 的衍生数据
    // 这样 Actor 就可以直接读取 item.system.totalLevelBonus
    this.totalLevelBonus = totalLevelReward;
    this.totalCheckBonus = totalCheckReward;
  }
}
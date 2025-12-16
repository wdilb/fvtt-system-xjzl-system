
import { XJZL } from "../../config.mjs"; // 导入配置，用于 choices
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

      // 奖励 (读完这一篇给什么)
      reward: new fields.SchemaField({
        level: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.ArtBook.RewardLevel" }), // 技艺等级 +N
        check: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.ArtBook.RewardCheck" })  // 检定加值 +N
      })
    });

    return {
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

      // 3. 修为投入 (总池)
      xpInvested: new fields.NumberField({ 
        min: 0, 
        initial: 0, 
        integer: true,
        label: "XJZL.ArtBook.XPInvested" 
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
   * 1. 计算每个章节的阅读进度 (已读、阅读中、未读)。
   * 2. 汇总所有已读章节提供的技艺等级和检定加成。
   */
  prepareDerivedData() {
    let currentXP = this.xpInvested;
    let totalLevelReward = 0;
    let totalCheckReward = 0;

    // 遍历所有章节，计算进度和累积奖励
    for (const chapter of this.chapters) {
      const chapterCost = chapter.cost || 0;

      // 进度条数据 (用于 UI 显示)
      chapter.progress = {
        current: 0,
        max: chapterCost,
        pct: 0,
        isCompleted: false
      };

      if (currentXP >= chapterCost) {
        // 章节已完成
        chapter.progress.current = chapterCost;
        chapter.progress.pct = 100;
        chapter.progress.isCompleted = true;
        
        // 累积奖励
        totalLevelReward += (chapter.reward?.level || 0);
        totalCheckReward += (chapter.reward?.check || 0);

        // 扣除已投入的 XP，用于计算下一章
        currentXP -= chapterCost;
      } else {
        // 章节阅读中或未开始
        chapter.progress.current = currentXP;
        if (chapterCost > 0) { // 避免除以零
          chapter.progress.pct = Math.min(100, Math.floor((currentXP / chapterCost) * 100));
        } else { // 如果章节消耗为0，默认完成
          chapter.progress.pct = 100;
          chapter.progress.isCompleted = true;
          totalLevelReward += (chapter.reward?.level || 0);
          totalCheckReward += (chapter.reward?.check || 0);
        }
        currentXP = 0; // 剩余 XP 不够，停止继续
      }
    }

    // 将累积的奖励存储为 Item 的衍生数据
    // 这样 Actor 就可以直接读取 item.system.totalLevelBonus
    this.totalLevelBonus = totalLevelReward;
    this.totalCheckBonus = totalCheckReward;
  }
}
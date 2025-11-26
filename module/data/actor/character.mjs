/**
 * 玩家角色 (PC) 数据模型
 * 系统：xjzl-system
 * 核心版本：Foundry VTT V13
 * 
 * 负责定义角色的核心数据结构与衍生数值计算逻辑。
 */
export class XJZLCharacterData extends foundry.abstract.TypeDataModel {

  /**
   * 定义数据库 Schema (数据结构)
   * 这里的字段会直接存储在 actors.db 数据库文件中。
   */
  static defineSchema() {
    const fields = foundry.data.fields;

    // --- 辅助构建函数：创建一个标准的基础属性字段 ---
    // 包含 value (当前值/初始值) 和 mod (修正值)
    const makeStatField = (labelKey) => new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 1, label: "XJZL.Stats.Chushi" }), // 初始值
      mod: new fields.NumberField({ required: true, integer: true, initial: 0, label: "XJZL.Stats.Xiuzheng" })  // 修正值
    }, { label: labelKey });

    // --- 辅助构建函数：创建一个资源字段 ---
    // 包含 value (当前值) 和 max (最大值)
    const makeResourceField = (initialVal = 0, maxVal = 0, labelKey) => new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: initialVal, label: labelKey }), // 当前值
      max: new fields.NumberField({ required: true, integer: true, initial: maxVal }), // 最大值 (虽然通常计算得出，但保留字段以便特殊覆盖)
      bonus: new fields.NumberField({ required: true, integer: true, initial: 0 })     // 额外上限加成 (装备或Buff提供)
    });

    return {
      // 1. 基础档案 (Info) - 角色扮演相关基础信息
      info: new fields.SchemaField({
        gender: new fields.StringField({ initial: "", label: "XJZL.Info.Gender" }),   // 性别
        zi: new fields.StringField({ initial: "", label: "XJZL.Info.Zi" }),           // 字
        chenghao: new fields.StringField({ initial: "", label: "XJZL.Info.Chenghao" }), // 称号
        age: new fields.NumberField({ min: 0, initial: 18, integer: true, label: "XJZL.Info.Age" }), // 年龄
        shengao: new fields.StringField({ initial: "", label: "XJZL.Info.Shengao" }), // 身高 (字符串，如"七尺")
        tizhong: new fields.StringField({ initial: "", label: "XJZL.Info.Tizhong" }), // 体重
        
        // 下拉选择项 (存储Key)
        menpai: new fields.StringField({ initial: "", label: "XJZL.Info.Menpai" }),   // 门派
        beijing: new fields.StringField({ initial: "", label: "XJZL.Info.Beijing" }), // 背景 (身份背景)
        xingge: new fields.StringField({ initial: "", label: "XJZL.Info.Xingge" }),   // 性格
        
        // 详细文本
        beijing_miaoshu: new fields.HTMLField({ label: "XJZL.Info.BeijingMiaoshu" }), // 背景描述 (富文本)
        waimao: new fields.StringField({ label: "XJZL.Info.Waimao" })                 // 外貌描述 (简述)
      }),

      // 2. 七维属性 (Stats) - 核心基础数值
      // 初始为1，变成负数触发死亡
      stats: new fields.SchemaField({
        wuxing: makeStatField("XJZL.Stats.Wuxing"),   // 悟性
        liliang: makeStatField("XJZL.Stats.Liliang"), // 力量
        shenfa: makeStatField("XJZL.Stats.Shenfa"),   // 身法
        neixi: makeStatField("XJZL.Stats.Neixi"),     // 内息
        tipo: makeStatField("XJZL.Stats.Tipo"),       // 体魄
        qigan: makeStatField("XJZL.Stats.Qigan"),     // 气感
        shencai: makeStatField("XJZL.Stats.Shencai")  // 神采
      }),

      // 3. 核心资源 (Resources) - 战斗消耗品
      resources: new fields.SchemaField({
        qixue: makeResourceField(10, 10, "XJZL.Resources.Qixue"), // 气血
        neili: makeResourceField(0, 0, "XJZL.Resources.Neili"),   // 内力
        nuqi: makeResourceField(0, 10, "XJZL.Resources.Nuqi"),    // 怒气
        
        dantian: new fields.NumberField({ min: 0, initial: 0, label: "XJZL.Resources.Dantian" }), // 丹田 (储存修为)
      }),

      // 4. 战斗属性修正 (Combat Modifiers)
      // 注意：这里的字段用于存储【非属性来源的固定加成】，例如“+10闪避的鞋子”。
      // 最终的面板数值会在 prepareDerivedData 中计算。
      combat: new fields.SchemaField({
        gedang: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.Gedang" }), // 格挡修正
        kanpo: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.Kanpo" }),   // 看破修正
        sudu: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.Sudu" }),     // 速度修正
        shanbi: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.Shanbi" }), // 闪避修正
        xiangong: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.Xiangong" }), // 先攻修正
        
        waigong_fangyu: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.WaigongFangyu" }), // 外功防御修正
        neigong_fangyu: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.NeigongFangyu" }), // 内功防御修正
        waigong_mingzhong: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.WaigongMingzhong" }), // 外功命中修正
        neigong_mingzhong: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.NeigongMingzhong" }), // 内功命中修正
        waigong_baoji: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.WaigongBaoji" }), // 外功暴击修正
        neigong_baoji: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.NeigongBaoji" })  // 内功暴击修正
      }),

      // 5. 武学状态 (Martial) - 记录当前状态
      martial: new fields.SchemaField({
        yunxing_neigong: new fields.StringField({ label: "XJZL.Resources.YunxingNeigong" }), // 当前运行内功 (存储Item UUID)
      }),

      // 6. 社交与声望 (Social) - 江湖属性
      social: new fields.SchemaField({
        // 声望数值
        chaoting_shengwang: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Social.ChaotingShengwang" }), // 朝廷声望
        wulin_shengwang: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Social.WulinShengwang" }),       // 武林声望
        
        // 善恶值
        xiayi: new fields.NumberField({ initial: 0, min: 0, integer: true, label: "XJZL.Social.Xiayi" }), // 侠义值
        exing: new fields.NumberField({ initial: 0, min: 0, integer: true, label: "XJZL.Social.Exing" }), // 恶行值
        
        // 处世态度 (重视/无视/普通)
        attitude_chaoting: new fields.StringField({ initial: "none", label: "XJZL.Social.AttitudeChaoting" }), // 朝廷态度
        attitude_wulin: new fields.StringField({ initial: "none", label: "XJZL.Social.AttitudeWulin" }),       // 武林态度
        attitude_shisu: new fields.StringField({ initial: "none", label: "XJZL.Social.AttitudeShisu" }),       // 世俗态度
        
        // 嗜好 (数组，限制3个)
        shihao: new fields.ArrayField(new fields.StringField(), { max: 3, label: "XJZL.Info.Shihao" }), 
        
        // 关系列表 (对象数组)
        guanxi: new fields.ArrayField(new fields.SchemaField({
          id: new fields.StringField(), // 目标角色ID (UUID)
          name: new fields.StringField(), // 目标姓名 (快照)
          type: new fields.StringField(), // 关系类型 (亲人/朋友/敌人)
          value: new fields.NumberField({ initial: 0 }) // 好感度数值
        }), { label: "XJZL.Social.Guanxi" })
      }),

      // 7. 经历/日志 (History) - 记录修为、银两变动
      jingli: new fields.ArrayField(new fields.SchemaField({
        date: new fields.StringField(),   // 记录时间
        type: new fields.StringField(),   // 类型 (修为/银两)
        amount: new fields.NumberField(), // 变动值
        reason: new fields.StringField()  // 原因/来源
      }))
    };
  }

  /**
   * 数据迁移与衍生计算 (Data Preparation)
   * 这里的所有计算都不会保存到数据库，而是每次加载角色时实时计算。
   */
  prepareDerivedData() {
    const stats = this.stats;
    const combat = this.combat;
    const resources = this.resources;

    // ---------------------------------------------------------
    // 1. 计算七维属性最终值 (Total)
    // 公式：Total = 初始值 + 修正值
    // ---------------------------------------------------------
    for (const [key, stat] of Object.entries(stats)) {
      stat.total = (stat.value || 0) + (stat.mod || 0);
      // 死亡判断：任何属性变负数即死
      if (stat.total < 0) this.parent.system.isDead = true; 
    }

    // 创建快捷引用对象 (S)，方便下方公式书写
    const S = {
      wuxing: stats.wuxing.total,   // 悟性
      liliang: stats.liliang.total, // 力量
      shenfa: stats.shenfa.total,   // 身法
      neixi: stats.neixi.total,     // 内息
      tipo: stats.tipo.total,       // 体魄
      qigan: stats.qigan.total,     // 气感
      shencai: stats.shencai.total  // 神采
    };

    // ---------------------------------------------------------
    // 2. 属性技能计算 (Derived Skills)
    // 公式：属性技能 = 对应主属性 / 10 (向下取整)
    // ---------------------------------------------------------
    
    this.skills = {
      // 力量系
      liliang: {
        jiaoli: Math.floor(S.liliang / 10),    // 角力
        zhengtuo: Math.floor(S.liliang / 10),  // 挣脱
        paozhi: Math.floor(S.liliang / 10),    // 抛掷
        qinbao: Math.floor(S.liliang / 10)     // 擒抱
      },
      // 身法系
      shenfa: {
        qianxing: Math.floor(S.shenfa / 10),   // 潜行
        qiaoshou: Math.floor(S.shenfa / 10),   // 巧手
        qinggong: Math.floor(S.shenfa / 10),   // 轻功 (注意：此值将用于速度计算)
        mashu: Math.floor(S.shenfa / 10)       // 马术
      },
      // 体魄系
      tipo: {
        renxing: Math.floor(S.tipo / 10),      // 韧性
        biqi: Math.floor(S.tipo / 10),         // 闭气
        rennai: Math.floor(S.tipo / 10),       // 忍耐
        ningxue: Math.floor(S.tipo / 10)       // 凝血
      },
      // 内息系
      neixi: {
        liaoshang: Math.floor(S.neixi / 10),   // 疗伤
        chongxue: Math.floor(S.neixi / 10),    // 冲穴
        lianxi: Math.floor(S.neixi / 10),      // 敛息
        duqi: Math.floor(S.neixi / 10)         // 渡气
      },
      // 气感系
      qigan: {
        dianxue: Math.floor(S.qigan / 10),     // 点穴
        zhuizong: Math.floor(S.qigan / 10),    // 追踪
        tancha: Math.floor(S.qigan / 10),      // 探查
        dongcha: Math.floor(S.qigan / 10)      // 洞察
      },
      // 神采系
      shencai: {
        jiaoyi: Math.floor(S.shencai / 10),    // 交易
        qiman: Math.floor(S.shencai / 10),     // 欺瞒
        shuofu: Math.floor(S.shencai / 10),    // 说服
        dingli: Math.floor(S.shencai / 10)     // 定力 (注意：这里是技能定力，非基础属性)
      }
    };

    // ---------------------------------------------------------
    // 3. 资源上限计算 (Resources Max)
    // ---------------------------------------------------------
    
    // 气血 (Max) = 体魄*4 + 力量*1 + 额外加成
    resources.qixue.max = Math.floor(S.tipo * 4 + S.liliang * 1 + (resources.qixue.bonus || 0));

    // 内力 (Max) = 内息*1 + 额外加成
    resources.neili.max = Math.floor(S.neixi * 1 + (resources.neili.bonus || 0));

    // 怒气 (Max) = 10 (默认上限)
    resources.nuqi.max = 10; 

    // ---------------------------------------------------------
    // 4. 战斗属性衍生计算 (Combat Derived)
    // 这里的 Total 才是最终面板上显示的数值
    // ---------------------------------------------------------
    
    // 格挡 = 初始0 + 装备修正
    combat.gedangTotal = 0 + combat.gedang; 

    // 看破 = 初始0 + 装备修正 (如果有内功加成，后续需叠加)
    combat.kanpoTotal = 0 + combat.kanpo; 

    // 速度 = 5 + [轻功技能]/2 + 装备修正
    combat.suduTotal = Math.floor(5 + (this.skills.shenfa.qinggong / 2) + combat.sudu);

    // 闪避 = 10 + 身法/4 + 装备修正
    combat.shanbiTotal = Math.floor(10 + (S.shenfa / 4) + combat.shanbi);

    // 先攻 = 身法等级 + 装备修正
    combat.xiangongTotal = Math.floor(S.shenfa + combat.xiangong);

    // 外功防御 = 体魄/5 + 装备修正
    combat.waigongFangyuTotal = Math.floor(S.tipo / 5 + combat.waigong_fangyu);

    // 内功防御 = 内息/3 + 装备修正
    combat.neigongFangyuTotal = Math.floor(S.neixi / 3 + combat.neigong_fangyu);

    // 外功命中 = 身法/2 + 装备修正
    combat.waigongMingzhongTotal = Math.floor(S.shenfa / 2 + combat.waigong_mingzhong);

    // 内功命中 = 气感/2 + 装备修正
    combat.neigongMingzhongTotal = Math.floor(S.qigan / 2 + combat.neigong_mingzhong);

    // 外功暴击 = 20 - 力量/20 + 装备修正 (注意：数值越小可能代表暴击率越低，或反之，按公式还原)
    combat.waigongBaojiTotal = Math.floor(20 - (S.liliang / 20) + combat.waigong_baoji);

    // 内功暴击 = 20 - 气感/20 + 装备修正
    combat.neigongBaojiTotal = Math.floor(20 - (S.qigan / 20) + combat.neigong_baoji);
  }
}
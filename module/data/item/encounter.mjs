const fields = foundry.data.fields;

const AUTOMATION_TYPES = ["damage", "healing", "rage", "description"];
const DAMAGE_TYPES = ["waigong", "neigong", "bleed", "poison", "mental", "fire", "liushi"];
const FIELD_TRIGGERS = [
  "combatStart", "roundStart", "roundEnd", "specificRoundStart",
  "intervalRoundStart", "combatantTurnStart", "combatantTurnEnd"
];

/** 支援动作配置；额度属于 NPC/编组层，动作本身只描述目标与结算。 */
const actionSchema = () => new fields.SchemaField({
  id: new fields.StringField({ required: true }),
  name: new fields.StringField({ required: true, initial: "" }),
  description: new fields.HTMLField({ initial: "" }),
  enabled: new fields.BooleanField({ initial: true }),
  targetMode: new fields.StringField({ initial: "selected", choices: ["selected", "friendlyAll", "hostileAll", "none"] }),
  maxTargets: new fields.NumberField({ initial: 1, min: 0, integer: true }),
  automationType: new fields.StringField({ initial: "description", choices: AUTOMATION_TYPES }),
  amountFormula: new fields.StringField({ initial: "0" }),
  damageType: new fields.StringField({ initial: "waigong", choices: DAMAGE_TYPES }),
  minRound: new fields.NumberField({ initial: 0, min: 0, integer: true }),
  cooldownRounds: new fields.NumberField({ initial: 0, min: 0, integer: true })
});

/** 支援 NPC 配置；Actor UUID 只用于关联时生成名称和头像快照。 */
const supportNpcSchema = () => new fields.SchemaField({
  id: new fields.StringField({ required: true }),
  sourceActorUuid: new fields.StringField({ initial: "" }),
  manualName: new fields.StringField({ initial: "" }),
  description: new fields.HTMLField({ initial: "" }),
  enabled: new fields.BooleanField({ initial: true }),
  encounterLimit: new fields.NumberField({ initial: 0, min: 0, integer: true }),
  actions: new fields.ArrayField(actionSchema(), { initial: [] })
});

/** 支援编组配置；每组独立控制权限、共享额度和本轮调用规则。 */
const supportGroupSchema = () => new fields.SchemaField({
  id: new fields.StringField({ required: true }),
  name: new fields.StringField({ required: true, initial: "" }),
  description: new fields.HTMLField({ initial: "" }),
  enabled: new fields.BooleanField({ initial: true }),
  permission: new fields.StringField({ initial: "gm", choices: ["gm", "players"] }),
  encounterLimit: new fields.NumberField({ initial: 0, min: 0, integer: true }),
  roundLimit: new fields.NumberField({ initial: 0, min: 0, integer: true }),
  oncePerNpcPerRound: new fields.BooleanField({ initial: true }),
  npcs: new fields.ArrayField(supportNpcSchema(), { initial: [] })
});

/**
 * 战局 Item 的持久化配置；运行状态会在关联时深拷贝到 Combat flags。
 */
export class XJZLEncounterData extends foundry.abstract.TypeDataModel {
  /**
   * 将第一版的单一 support 协议包装为默认编组。
   * 固定 legacy ID 可保证旧 Item 在真正保存迁移前，每次加载仍保持稳定引用。
   */
  static migrateData(source) {
    super.migrateData(source);
    const support = source.support;
    if (!support || Array.isArray(support.groups)) return source;
    const hasLegacyData = Array.isArray(support.npcs)
      || ["permission", "encounterLimit", "roundLimit", "oncePerNpcPerRound"].some(key => key in support);
    support.groups = hasLegacyData ? [{
      id: "legacy-support",
      name: "",
      description: "",
      enabled: true,
      permission: support.permission ?? "gm",
      encounterLimit: support.encounterLimit ?? 0,
      roundLimit: support.roundLimit ?? 0,
      oncePerNpcPerRound: support.oncePerNpcPerRound ?? true,
      npcs: support.npcs ?? []
    }] : [];
    return source;
  }

  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: "", label: "XJZL.Encounter.Description" }),
      fieldEffects: new fields.ArrayField(new fields.SchemaField({
        id: new fields.StringField({ required: true }),
        name: new fields.StringField({ required: true, initial: "" }),
        description: new fields.HTMLField({ initial: "" }),
        enabled: new fields.BooleanField({ initial: true }),
        trigger: new fields.StringField({ initial: "roundStart", choices: FIELD_TRIGGERS }),
        triggerValue: new fields.NumberField({ initial: 1, min: 1, integer: true }),
        targetMode: new fields.StringField({ initial: "friendly", choices: ["friendly", "hostile", "custom"] }),
        automationType: new fields.StringField({ initial: "description", choices: AUTOMATION_TYPES }),
        amountFormula: new fields.StringField({ initial: "0" }),
        damageType: new fields.StringField({ initial: "waigong", choices: DAMAGE_TYPES })
      }), { initial: [] }),
      support: new fields.SchemaField({
        groups: new fields.ArrayField(supportGroupSchema(), { initial: [] })
      })
    };
  }
}

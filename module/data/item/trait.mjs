import { makeScriptEffectSchema } from "../common.mjs";

export class XJZLTraitData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        const fields = foundry.data.fields;
        return {
            description: new fields.HTMLField({ label: "XJZL.Info.Description" }),
            automationNote: new fields.StringField({ initial: "", label: "XJZL.AutomationNote" }),
            type: new fields.StringField({ initial: "general", label: "XJZL.Trait.TypeLabel" }),

            // 核心：存放脚本的容器
            scripts: new fields.ArrayField(makeScriptEffectSchema(), {
                label: "XJZL.Item.ScriptList",
                initial: []
            })
        };
    }
}
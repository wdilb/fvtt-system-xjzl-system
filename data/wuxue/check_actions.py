import json
import os
from pathlib import Path

# 1. 定义最终允许的标准动作列表
VALID_ACTIONS = {
    "主要动作",
    "次要动作",
    "蓄力动作",
    "反应动作",
    "全回合动作",
    "简要动作",
    "无"
}

# 2. 定义用于在 description 中搜索的关键词（不包含“无”）
SEARCH_KEYWORDS = [
    "主要动作",
    "次要动作",
    "蓄力动作",
    "反应动作",
    "全回合动作",
    "简要动作"
]

# 3. 定义简称映射（用于补全）
# 如果分割后剩下的是 key，则自动映射为 value
SHORT_NAMES = {
    "主要": "主要动作",
    "次要": "次要动作",
    "蓄力": "蓄力动作",
    "反应": "反应动作",
    "全回合": "全回合动作",
    "简要": "简要动作"
}

def find_action_in_description(desc):
    """
    在描述文本中查找最早出现的动作关键词
    """
    if not desc or not isinstance(desc, str):
        return None
    
    best_index = float('inf')
    best_match = None
    
    for kw in SEARCH_KEYWORDS:
        idx = desc.find(kw)
        if idx != -1 and idx < best_index:
            best_index = idx
            best_match = kw
            
    return best_match

def normalize_cost_string(raw_val):
    """
    清洗并规范化 actionCost 字符串
    返回: (清洗后的值, 是否在白名单中)
    """
    if not isinstance(raw_val, str):
        return "无", True # 非字符串强制转无
        
    # 1. 去掉 / 及其后面的内容，并去空格
    clean_val = raw_val.split('/')[0].strip()
    
    # 2. 如果已经在白名单里，直接返回
    if clean_val in VALID_ACTIONS:
        return clean_val, True
        
    # 3. 尝试补全（例如 "主要" -> "主要动作"）
    if clean_val in SHORT_NAMES:
        return SHORT_NAMES[clean_val], True
        
    # 4. 如果都不匹配（例如 "被动"），返回原始清洗值，标记为 False
    return clean_val, False

def process_file(file_path):
    """
    处理单个文件，如果有修改则保存
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ [读取失败] {file_path.name}: {e}")
        return

    # 兼容 List 或 Dict 根节点
    items_list = []
    if isinstance(data, list):
        items_list = data
    elif isinstance(data, dict):
        items_list = [data]
    else:
        return

    file_modified = False
    
    for item in items_list:
        item_name = item.get("name", "未命名")
        system = item.get("system", {})
        if not isinstance(system, dict): continue
        
        moves = system.get("moves", [])
        if not isinstance(moves, list): continue
        
        for i, move in enumerate(moves):
            move_name = move.get("name", f"招式#{i+1}")
            original_cost = move.get("actionCost")
            
            new_cost = None
            log_msg = ""
            
            # --- 逻辑分支 ---
            
            # 1. 缺少 actionCost 字段
            if "actionCost" not in move:
                desc = move.get("description", "")
                found_action = find_action_in_description(desc)
                
                if found_action:
                    new_cost = found_action
                    log_msg = f"缺少字段 -> 从描述提取: {new_cost}"
                else:
                    new_cost = "无"
                    log_msg = f"缺少字段 -> 描述未匹配 -> 设为: 无"
            
            # 2. 存在 actionCost 字段，需要清洗
            else:
                processed_val, is_valid = normalize_cost_string(original_cost)
                
                if is_valid:
                    # 如果不一样才更新（例如 "主要/反应" -> "主要动作"）
                    if processed_val != original_cost:
                        new_cost = processed_val
                        log_msg = f"规范化: '{original_cost}' -> '{new_cost}'"
                else:
                    # 不在白名单且无法补全（例如 "被动"），强制改为 "无"
                    new_cost = "无"
                    if original_cost != "无":
                        log_msg = f"非法值强制置空: '{original_cost}' -> '无'"

            # --- 应用修改 ---
            if new_cost is not None:
                move["actionCost"] = new_cost
                file_modified = True
                print(f"🔧 [修改] {file_path.name} | {item_name} - {move_name}: {log_msg}")

    # 只有在发生修改时才写入文件
    if file_modified:
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                # ensure_ascii=False 保证中文不转义
                # indent=4 保持原有缩进格式
                json.dump(data, f, ensure_ascii=False, indent=4)
            print(f"💾 [保存] 已更新文件: {file_path.name}")
        except Exception as e:
            print(f"❌ [保存失败] {file_path.name}: {e}")

def main():
    base_dir = Path(__file__).resolve().parent
    print(f"📂 开始处理目录: {base_dir}")
    print("⚠️  注意：'无法处理'的情况已按要求强制改为 '无'")
    print("-" * 60)

    json_files = list(base_dir.rglob("*.json"))
    
    for json_file in json_files:
        if json_file.name.startswith("."): continue
        process_file(json_file)

    print("-" * 60)
    print("✅ 处理完成。")

if __name__ == "__main__":
    main()
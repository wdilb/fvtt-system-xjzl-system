import json
import os

# =================配置区域=================

# 数据文件目录 (请根据实际情况修改)
TARGET_DIR = "./data/wuxue"

# 定义要替换的旧代码模式列表
OLD_CODES = [
    "const lvl = Math.max(1, args.move.computedLevel || 1);",
    "const lvl = Math.max(1, move.computedLevel || 1);"
]

# 定义替换后的新代码模式
NEW_CODE = (
    "const stanceId = actor.system.martial.stance;\n"
    "    const moveData = thisItem.system.moves.find(m => m.id === stanceId);\n"
    "    const lvl = Math.max(1, moveData?.computedLevel || 1);"
)

# =========================================

def process_file(file_path):
    """读取文件，处理 JSON 数据，替换目标脚本片段，然后写回。"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"❌ [错误] 无法解析 JSON: {file_path}\n   原因: {e}")
        return 0
    except Exception as e:
        print(f"❌ [错误] 读取失败: {file_path}\n   原因: {e}")
        return 0

    file_modified_count = 0
    items_modified = False

    # 兼容单对象或数组结构
    if isinstance(data, list):
        items = data
    else:
        items = [data]

    # 遍历 Item
    for item in items:
        item_name = item.get("name", "Unknown Item")
        system = item.get("system", {})
        moves = system.get("moves", [])
        
        if not isinstance(moves, list):
            continue

        # 遍历 Moves
        for move in moves:
            move_name = move.get("name", "Unknown Move")
            scripts = move.get("scripts", [])
            
            if not isinstance(scripts, list):
                continue

            # 遍历 Scripts
            for script_obj in scripts:
                script_label = script_obj.get("label", "Unnamed Script")
                trigger = script_obj.get("trigger")
                script_content = script_obj.get("script", "")

                # 核心判断：触发器是 damaged 且 包含任意一种旧代码
                if trigger == "damaged":
                    # 检查是否包含任意一种旧代码
                    contains_old_code = False
                    matched_code = None
                    
                    for old_code in OLD_CODES:
                        if old_code in script_content:
                            contains_old_code = True
                            matched_code = old_code
                            break
                    
                    # 如果包含旧代码，执行替换
                    if contains_old_code:
                        # --- 执行替换 ---
                        new_content = script_content.replace(matched_code, NEW_CODE)
                        script_obj["script"] = new_content
                        
                        # --- 详细日志 ---
                        print(f"  🔧 [修复] 文件: {os.path.basename(file_path)}")
                        print(f"     武学: {item_name}")
                        print(f"     招式: {move_name}")
                        print(f"     脚本: {script_label} (Trigger: damaged)")
                        print(f"     替换模式: {matched_code[:50]}...")
                        print("-" * 40)
                        
                        file_modified_count += 1
                        items_modified = True

    # 只有当文件内容真的发生变化时才写入
    if items_modified:
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
            # print(f"  💾 已保存文件: {file_path}\n")
        except Exception as e:
            print(f"❌ [错误] 写入失败: {file_path}\n   原因: {e}")
    
    return file_modified_count

def main():
    if not os.path.exists(TARGET_DIR):
        print(f"❌ 目录不存在: {TARGET_DIR}")
        return

    print(f"🚀 开始扫描目录: {TARGET_DIR} ...\n")
    
    total_files_scanned = 0
    total_scripts_fixed = 0
    files_with_changes = 0

    for root, dirs, files in os.walk(TARGET_DIR):
        for file in files:
            if file.endswith(".json"):
                file_path = os.path.join(root, file)
                total_files_scanned += 1
                
                fixed_count = process_file(file_path)
                
                if fixed_count > 0:
                    total_scripts_fixed += fixed_count
                    files_with_changes += 1

    print("\n" + "="*30)
    print("📊 批量替换完成")
    print("="*30)
    print(f"📂 扫描文件数: {total_files_scanned}")
    print(f"📝 修改文件数: {files_with_changes}")
    print(f"🔧 修复脚本数: {total_scripts_fixed}")
    print(f"🔍 搜索模式数: {len(OLD_CODES)}")
    print("="*30)

if __name__ == "__main__":
    main()
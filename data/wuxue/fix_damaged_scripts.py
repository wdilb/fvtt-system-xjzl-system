import json
import os
import re

# =================配置区域=================

# 数据文件目录
TARGET_DIR = "./data/wuxue"

# 定义正确的代码块 (用于计算真实等级)
# 注意：这里我们加上换行符，确保插入时格式整洁
CORRECT_LOGIC_BLOCK = (
    "// 获取当前架招等级\n"
    "    const stanceId = actor.system.martial.stance;\n"
    "    const moveData = thisItem.system.moves.find(m => m.id === stanceId);\n"
    "    const lvl = Math.max(1, moveData?.computedLevel || 1);"
)

# =========================================

def fix_script_content(content):
    """
    使用正则智能修复脚本内容。
    返回: (new_content, modified_bool)
    """
    
    # 正则表达式解释：
    # (?:args\.)?move\.computedLevel
    # 匹配 "move.computedLevel" 或者 "args.move.computedLevel"
    error_pattern = r'(?:args\.)?move\.computedLevel'
    
    # 如果脚本里没有错误的引用，直接返回
    if not re.search(error_pattern, content):
        return content, False

    # ---------------------------------------------------------
    # 情况 A: 脚本里本来就定义了 const lvl = ... (旧模板)
    # ---------------------------------------------------------
    # 匹配类似: const lvl = Math.max(1, args.move.computedLevel || 1);
    # 允许中间有空格
    var_decl_pattern = r'const\s+lvl\s*=\s*Math\.max\(1,\s*(?:args\.)?move\.computedLevel\s*\|\|\s*1\);'
    
    if re.search(var_decl_pattern, content):
        # 直接把这一行替换成我们要的逻辑块
        new_content = re.sub(var_decl_pattern, CORRECT_LOGIC_BLOCK, content)
        return new_content, True

    # ---------------------------------------------------------
    # 情况 B: 脚本里直接用了 args.move.computedLevel (内联使用)
    # ---------------------------------------------------------
    # 策略：
    # 1. 把文中所有的 args.move.computedLevel 替换成 lvl
    # 2. 在脚本的最开头插入 lvl 的定义代码
    
    # 替换所有的错误引用为 'lvl'
    new_content = re.sub(error_pattern, 'lvl', content)
    
    # 在头部插入定义代码
    # 简单的拼接，加个换行
    new_content = CORRECT_LOGIC_BLOCK + "\n\n    " + new_content.lstrip()
    
    return new_content, True

def process_file(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ [错误] 读取失败: {file_path}\n   原因: {e}")
        return 0

    file_modified_count = 0
    items_modified = False

    if isinstance(data, list):
        items = data
    else:
        items = [data]

    for item in items:
        item_name = item.get("name", "Unknown Item")
        system = item.get("system", {})
        moves = system.get("moves", [])
        
        if not isinstance(moves, list):
            continue

        for move in moves:
            move_name = move.get("name", "Unknown Move")
            scripts = move.get("scripts", [])
            
            if not isinstance(scripts, list):
                continue

            for script_obj in scripts:
                trigger = script_obj.get("trigger")
                script_content = script_obj.get("script", "")

                # 核心判断：只有 damaged 时机，且存在错误引用
                if trigger == "damaged":
                    new_content, modified = fix_script_content(script_content)
                    
                    if modified:
                        script_obj["script"] = new_content
                        
                        print(f"  🔧 [修复] 文件: {os.path.basename(file_path)}")
                        print(f"     武学: {item_name} -> 招式: {move_name}")
                        print(f"     类型: {trigger}")
                        print("-" * 40)
                        
                        file_modified_count += 1
                        items_modified = True

    if items_modified:
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
        except Exception as e:
            print(f"❌ [错误] 写入失败: {file_path}\n   原因: {e}")
    
    return file_modified_count

def main():
    if not os.path.exists(TARGET_DIR):
        print(f"❌ 目录不存在: {TARGET_DIR}")
        return

    print(f"🚀 开始智能扫描目录 (Regex模式): {TARGET_DIR} ...\n")
    
    total_fixed = 0
    
    for root, dirs, files in os.walk(TARGET_DIR):
        for file in files:
            if file.endswith(".json"):
                file_path = os.path.join(root, file)
                total_fixed += process_file(file_path)

    print("\n" + "="*30)
    print(f"✅ 修复完成! 共修复了 {total_fixed} 处脚本错误。")
    print("="*30)

if __name__ == "__main__":
    main()
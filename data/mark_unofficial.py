import os
import json
from pathlib import Path

def main():
    # 1. 获取脚本文件自身所在的绝对目录
    script_dir = Path(__file__).resolve().parent
    print(f"🚀 开始扫描目录: {script_dir}\n")

    # 2. 递归查找所有 .json 文件
    json_files = list(script_dir.rglob("*.json"))
    
    if not json_files:
        print("⚠️ 未在当前目录及子目录中找到任何 JSON 文件。")
        return

    total_files_modified = 0
    total_items_modified = 0

    for file_path in json_files:
        try:
            # 读取 JSON 数据
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f"❌ [跳过] 无法读取或解析 {file_path.name}: {e}")
            continue

        modified = False
        file_match_count = 0

        # 兼容你的数据结构：有时候是列表 [{}], 有时候是单个对象 {}
        items = data if isinstance(data, list) else [data]

        for item in items:
            if not isinstance(item, dict):
                continue
            
            # 获取 name 字段
            name = item.get("name", "")
            
            # 检查是否包含关键字
            if "2025年共创" in name:
                # 确保 system 字典存在
                if "system" not in item:
                    item["system"] = {}
                
                # 只有当 isOfficial 还没被设为 false 时才操作，避免重复写入
                if item["system"].get("isOfficial") is not False:
                    item["system"]["isOfficial"] = False
                    modified = True
                    file_match_count += 1
                    print(f"  👉 命中数据: [{name}] (位于 {file_path.name})")

        # 3. 如果有修改，将数据写回原文件 (无备份)
        if modified:
            try:
                with open(file_path, 'w', encoding='utf-8') as f:
                    # ensure_ascii=False 保证中文正常显示，indent=4 保证格式美观
                    # 如果你平时的 JSON 是 2 个空格缩进，可以把 indent 改为 2
                    json.dump(data, f, ensure_ascii=False, indent=4)
                
                print(f"✅ 成功更新文件: {file_path.relative_to(script_dir)} (修改了 {file_match_count} 条数据)\n")
                total_files_modified += 1
                total_items_modified += file_match_count
            except Exception as e:
                print(f"❌[错误] 无法写入文件 {file_path.name}: {e}\n")

    print("==================================================")
    print(f"🎉 扫描完毕！共修改了 {total_files_modified} 个文件，标记了 {total_items_modified} 条非官方数据。")

if __name__ == "__main__":
    main()
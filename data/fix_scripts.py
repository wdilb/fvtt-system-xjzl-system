import os
import json

# 目标替换字符
TARGET = "args.actor"
REPLACEMENT = "actor"

def process_value(value):
    """
    递归处理 JSON 数据结构
    返回: (bool) 是否发生了修改
    """
    modified = False

    if isinstance(value, dict):
        for key, sub_val in value.items():
            # 核心逻辑：找到 key 为 "scripts" 且值是列表的地方
            if key == "scripts" and isinstance(sub_val, list):
                for script_obj in sub_val:
                    if isinstance(script_obj, dict) and "script" in script_obj:
                        original_script = script_obj["script"]
                        if TARGET in original_script:
                            # 执行替换
                            new_script = original_script.replace(TARGET, REPLACEMENT)
                            script_obj["script"] = new_script
                            modified = True
                            # 打印简略日志（去掉换行符以便显示）
                            print(f"   [修复] ...{original_script.strip()[:30]}... -> ...{new_script.strip()[:30]}...")
            
            # 继续递归深入字典的值
            if isinstance(sub_val, (dict, list)):
                if process_value(sub_val):
                    modified = True

    elif isinstance(value, list):
        # 递归深入列表中的项
        for item in value:
            if isinstance(item, (dict, list)):
                if process_value(item):
                    modified = True

    return modified

def main():
    root_dir = os.getcwd()  # 获取当前目录
    print(f"开始扫描目录: {root_dir}")
    print("-" * 50)

    total_files = 0
    modified_files = 0

    for dirpath, dirnames, filenames in os.walk(root_dir):
        for filename in filenames:
            if filename.endswith(".json"):
                total_files += 1
                file_path = os.path.join(dirpath, filename)
                
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)

                    # 处理数据
                    if process_value(data):
                        print(f"检测到文件修改: {filename}")
                        
                        # 写回文件
                        with open(file_path, 'w', encoding='utf-8') as f:
                            # ensure_ascii=False 确保中文不变成 \uXXXX
                            json.dump(data, f, indent=4, ensure_ascii=False)
                        
                        modified_files += 1
                
                except json.JSONDecodeError:
                    print(f"[错误] 无法解析 JSON: {file_path}")
                except Exception as e:
                    print(f"[错误] 处理文件失败 {file_path}: {e}")

    print("-" * 50)
    print(f"扫描完成。")
    print(f"总计扫描: {total_files} 个文件")
    print(f"修复文件: {modified_files} 个文件")

if __name__ == "__main__":
    main()
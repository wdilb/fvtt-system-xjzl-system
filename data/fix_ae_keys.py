import os
import json

# 设置需要遍历的根目录，'.' 代表当前脚本所在目录
ROOT_DIR = '.'

# 不需要添加 system. 前缀的特殊根路径 (Foundry VTT 标准)
# 如果 key 以这些开头，脚本将忽略它
EXCLUDED_PREFIXES = (
    "system.",
    "flags.",
    "macro.",
    "token.",
    "actor."
)

def should_add_prefix(key):
    """
    判断是否需要添加 system. 前缀
    """
    if not key:
        return False
    # 如果已经以 system. 开头，或者以 flags. 等特殊根节点开头，则不修改
    if key.startswith(EXCLUDED_PREFIXES):
        return False
    return True

def traverse_and_fix(data, file_path, modified_flag):
    """
    递归遍历 JSON 数据结构
    """
    if isinstance(data, dict):
        # 1. 检查是否存在 'changes' 字段 (ActiveEffect 的修改项)
        if 'changes' in data and isinstance(data['changes'], list):
            for change in data['changes']:
                if isinstance(change, dict) and 'key' in change:
                    original_key = change['key']
                    
                    if should_add_prefix(original_key):
                        new_key = f"system.{original_key}"
                        change['key'] = new_key
                        modified_flag[0] = True
                        print(f"[修改] {file_path}")
                        print(f"      Key: '{original_key}' -> '{new_key}'")

        # 2. 递归遍历字典的其他键
        for k, v in data.items():
            # 【重要】严格跳过 masteryChanges，不进入该字段内部扫描
            if k == 'masteryChanges':
                continue
            
            traverse_and_fix(v, file_path, modified_flag)

    elif isinstance(data, list):
        # 递归遍历列表中的每一项
        for item in data:
            traverse_and_fix(item, file_path, modified_flag)

def process_file(file_path):
    """
    处理单个文件
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError):
        print(f"[错误] 无法读取或解析 JSON: {file_path}")
        return

    # 使用列表作为可变对象在递归中传递修改状态
    modified = [False]
    
    traverse_and_fix(data, file_path, modified)

    if modified[0]:
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                # ensure_ascii=False 保证中文字符不被转义为 \uXXXX
                json.dump(data, f, indent=4, ensure_ascii=False)
            print(f"[保存] 已更新文件: {file_path}\n")
        except Exception as e:
            print(f"[错误] 保存文件失败 {file_path}: {e}")

def main():
    print(f"开始扫描目录: {os.path.abspath(ROOT_DIR)} ...\n")
    
    count = 0
    for root, dirs, files in os.walk(ROOT_DIR):
        for file in files:
            if file.endswith('.json'):
                file_path = os.path.join(root, file)
                process_file(file_path)
                count += 1
    
    print(f"\n扫描结束。共扫描 {count} 个 JSON 文件。")

if __name__ == "__main__":
    main()
import os
import json
import re

def process_script_content(script_text):
    """
    处理单段 JS 脚本字符串，寻找 applyDamage({ ... }) 并注入 source: 'dot'
    """
    # 匹配 applyDamage 的开头
    pattern = r'(applyDamage\s*\(\s*\{)'
    modified = False
    new_text = ""
    last_end = 0
    
    # 使用 finditer 遍历所有 applyDamage 调用
    for match in re.finditer(pattern, script_text):
        start = match.start()
        end = match.end()
        
        # 寻找匹配的右括号 '}'
        brace_count = 1
        close_idx = -1
        for i in range(end, len(script_text)):
            if script_text[i] == '{':
                brace_count += 1
            elif script_text[i] == '}':
                brace_count -= 1
                if brace_count == 0:
                    close_idx = i
                    break
        
        # 如果找到了完整的参数对象 {...}
        if close_idx != -1:
            inner_content = script_text[end:close_idx]
            
            # 条件1: 检查是否包含 type: 'liushi' 或 "liushi"
            # (?i) 忽略大小写，兼容可能存在的空格
            if re.search(r'''type\s*:\s*['"]liushi['"]''', inner_content, re.IGNORECASE):
                new_text += script_text[last_end:close_idx] # 不做修改
                
            # 条件2: 检查是否已经包含 source 参数 (防重复注入)
            elif re.search(r'''source\s*:''', inner_content):
                new_text += script_text[last_end:close_idx] # 不做修改
                
            # 执行注入
            else:
                # 拼接：前半部分 + 注入的内容 + 原本花括号里的内容
                new_text += script_text[last_end:end] + " source: 'dot'," + inner_content
                modified = True
            
            last_end = close_idx
        else:
            # 万一括号不匹配（通常不会），回退不做修改
            new_text += script_text[last_end:end]
            last_end = end
            
    # 加上最后剩余的字符串
    new_text += script_text[last_end:]
    return new_text, modified

def traverse_and_modify(data, logs):
    """
    递归遍历 JSON 对象，寻找特定脚本
    """
    modified = False
    if isinstance(data, dict):
        # 命中脚本节点的特征
        if "trigger" in data and "script" in data:
            if data["trigger"] in ["turnStart", "turnEnd"]:
                new_script, is_mod = process_script_content(data["script"])
                if is_mod:
                    data["script"] = new_script
                    modified = True
                    label = data.get("label", "未命名脚本")
                    logs.append(f"    - [注入 DoT] 特效名称: {label} (触发器: {data['trigger']})")
        
        # 继续深入字典
        for k, v in data.items():
            if traverse_and_modify(v, logs):
                modified = True
                
    elif isinstance(data, list):
        # 遍历列表
        for item in data:
            if traverse_and_modify(item, logs):
                modified = True
                
    return modified

def main():
    # 获取 Python 脚本自身所在的绝对路径目录
    base_dir = os.path.dirname(os.path.abspath(__file__))
    print(f"🚀 开始扫描目录: {base_dir}\n")
    
    total_files = 0
    modified_files = 0
    
    # 递归遍历目录
    for root, dirs, files in os.walk(base_dir):
        for file in files:
            if file.endswith(".json"):
                total_files += 1
                filepath = os.path.join(root, file)
                
                # 1. 读取 JSON
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                except Exception as e:
                    print(f"❌ 读取文件失败: {filepath} ({e})")
                    continue
                    
                # 2. 遍历并修改
                logs =[]
                is_modified = traverse_and_modify(data, logs)
                
                # 3. 如果有修改，回写 JSON 并打印日志
                if is_modified:
                    try:
                        # FVTT 默认使用 2 个空格缩进，ensure_ascii=False 保证中文正常显示
                        with open(filepath, 'w', encoding='utf-8') as f:
                            json.dump(data, f, ensure_ascii=False, indent=2)
                        
                        rel_path = os.path.relpath(filepath, base_dir)
                        print(f"📄 已更新文件: {rel_path}")
                        for log in logs:
                            print(log)
                        print("-" * 50)
                        modified_files += 1
                        
                    except Exception as e:
                        print(f"❌ 写入文件失败: {filepath} ({e})")

    print(f"\n✅ 扫描完成！共检查 {total_files} 个 JSON 文件，成功注入 {modified_files} 个文件。")

if __name__ == "__main__":
    main()
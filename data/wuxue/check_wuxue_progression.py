import json
import os
import re

# =================配置区域=================

# 增强版正则：同时匹配 "修为 1000" 和 "1000 修为"
# group(1): 匹配 "修为 1000" 格式中的数字
# group(2): 匹配 "1000 修为" 格式中的数字
REGEX_PATTERN = r"(?:修为\s*[:：]?\s*(\d+))|(\d+)\s*(?:点)?\s*修为"

# =========================================

def strip_html(text):
    """简单的去HTML标签函数"""
    if not text:
        return ""
    # 将 None 强制转为字符串防止报错
    text = str(text) 
    clean = re.compile('<.*?>')
    return re.sub(clean, '', text)

def find_cultivation_nums(text):
    """
    从文本中提取大于等于100的修为数值
    返回: list of ints
    """
    clean_text = strip_html(text)
    matches = re.finditer(REGEX_PATTERN, clean_text)
    nums = []
    
    for match in matches:
        # group(1) 是 "修为 1000", group(2) 是 "1000 修为"
        num_str = match.group(1) if match.group(1) else match.group(2)
        if not num_str:
            continue

        number = int(num_str)
        
        # 过滤小数字，只关注 >= 100 的门槛
        if number >= 100:
            nums.append(number)
            
    return nums

def check_move_progression(file_path, item_name, move_data, system_reqs):
    """
    检查单个招式的数据一致性
    :param system_reqs: 顶层 item.system.requirements 的文本
    """
    move_name = move_data.get('name', '未命名招式')
    
    # === 1. 收集所有可能的文本源 ===
    move_desc = move_data.get('description', '')
    move_reqs = move_data.get('requirements', '') # 招式里的 requirements 字段
    
    # 构造检查队列：(来源名称, 文本内容)
    sources = [
        ("招式描述", move_desc),
        ("招式需求", move_reqs),
        ("系统总需求", system_reqs)
    ]
    
    found_info = [] # 存储 (来源, 数值)
    all_found_nums = set() #用于后续判断是否为空

    # === 2. 遍历所有文本源查找数值 ===
    for source_name, text in sources:
        nums = find_cultivation_nums(text)
        if nums:
            found_info.append(f"{source_name}:{nums}")
            for n in nums:
                all_found_nums.add(n)

    # 如果所有地方都没找到修为要求，直接跳过
    if not all_found_nums:
        return None

    # === 3. 检查数据结构 ===
    progression = move_data.get('progression', {})
    mode = progression.get('mode', 'standard') 
    thresholds = progression.get('customThresholds', [])

    # === 4. 判定逻辑 ===
    is_error = False
    error_reason = ""

    # 只要检测到大额修为数字，我们严格要求必须是 custom 模式且有阈值
    if mode != 'custom':
        is_error = True
        error_reason = f"检测到数值 {found_info}，但 mode='{mode}' (需改为 custom)"
    elif not thresholds or len(thresholds) == 0:
        is_error = True
        error_reason = f"检测到数值 {found_info}，但 customThresholds 为空"
    
    if is_error:
        return {
            "file": os.path.basename(file_path),
            "item": item_name,
            "move": move_name,
            "reason": error_reason,
            "nums": list(all_found_nums)
        }
    
    return None

def process_file(file_path):
    issues = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = json.load(f)
            
        items = content if isinstance(content, list) else [content]
        
        for item in items:
            item_name = item.get('name', '未命名物品')
            system = item.get('system', {})
            
            # === 提取顶层系统需求 ===
            # 有些数据里 requirements 可能是 null，用 get('', '') 兜底
            system_reqs = system.get('requirements') or ""
            
            moves = system.get('moves', [])
            
            if not moves:
                continue
                
            for move in moves:
                # 将顶层需求传入检查函数
                result = check_move_progression(file_path, item_name, move, system_reqs)
                if result:
                    issues.append(result)
                    
    except Exception as e:
        print(f"❌ 读取文件出错: {file_path} \n错误信息: {e}")
        
    return issues

def main():
    print("🔍 开始全量扫描 JSON 文件 (包含 requirements 字段检查)...")
    current_dir = os.getcwd()
    all_issues = []
    
    for root, dirs, files in os.walk(current_dir):
        for file in files:
            if file.endswith(".json"):
                full_path = os.path.join(root, file)
                all_issues.extend(process_file(full_path))

    if all_issues:
        print(f"\n⚠️  发现 {len(all_issues)} 个潜在的数据不一致：")
        print("请检查下列招式：需补全 progression 字段。\n")
        
        # 格式化输出表头
        header = f"{'JSON文件':<20} | {'物品名称':<12} | {'招式名称':<12} | {'错误原因 (来源:数值)'}"
        print(header)
        print("-" * 100)
        
        for issue in all_issues:
            # 缩短一下文件名显示
            f_name = issue['file']
            if len(f_name) > 20: f_name = f_name[:17] + "..."
            
            print(f"{f_name:<20} | {issue['item']:<12} | {issue['move']:<12} | {issue['reason']}")
            
        print("\n提示: 系统会自动扫描 Item.system.requirements、Move.requirements 和 Move.description。")
    else:
        print("\n✅ 检查完成，未发现异常。")

if __name__ == "__main__":
    main()
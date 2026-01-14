import json
import os
import sys

def get_script_dir():
    """获取脚本文件所在的绝对路径"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    else:
        return os.path.dirname(os.path.abspath(__file__))

def calculate_next_value(values):
    """
    根据列表最后两个值计算等差数列的下一个值
    """
    if not isinstance(values, list) or len(values) < 2:
        return None
    # 确保列表里是数字
    if not all(isinstance(x, (int, float)) for x in values):
        return None

    # 取最后两个数计算差值
    last_val = values[-1]
    prev_val = values[-2]
    
    diff = last_val - prev_val
    next_val = last_val + diff
    
    # 保持类型一致（如果是整数就保持整数）
    if isinstance(last_val, int) and isinstance(prev_val, int):
        return int(next_val)
    return next_val

def fix_json_files():
    current_dir = get_script_dir()
    print(f"正在扫描目录: {current_dir}")
    
    json_files = [f for f in os.listdir(current_dir) if f.endswith('.json')]
    
    if not json_files:
        print("当前目录下没有找到json文件。")
        input("按回车键退出...")
        return

    print(f"找到 {len(json_files)} 个JSON文件，开始处理...\n")

    for filename in json_files:
        file_path = os.path.join(current_dir, filename)
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            is_modified = False
            
            # 遍历最外层的列表 (武学列表)
            if isinstance(data, list):
                for item in data:
                    system_data = item.get("system", {})
                    
                    # 获取父级 Tier，默认1
                    parent_tier = system_data.get("tier", 1) 
                    
                    moves = system_data.get("moves", [])
                    item_name = item.get("name", "未知武学")
                    
                    for move in moves:
                        # === Tier 判定逻辑 ===
                        # 优先读取招式(move)里的 tier，如果没有则使用父级(system)的 tier
                        move_specific_tier = move.get("tier")
                        
                        if move_specific_tier is not None:
                            try:
                                current_tier = int(move_specific_tier)
                            except ValueError:
                                current_tier = int(parent_tier)
                        else:
                            current_tier = int(parent_tier)
                        # ===================
                        
                        # 确定目标长度：Tier 3 需要 4 个，其他 Tier 需要 3 个
                        target_len = 4 if current_tier == 3 else 3

                        costs = move.get("costs", {})
                        move_name = move.get("name", "未知招式")
                        
                        # 遍历 costs 下的所有消耗类型
                        for cost_type in list(costs.keys()):
                            values = costs[cost_type]
                            
                            # 跳过非列表或空列表
                            if not isinstance(values, list):
                                continue
                            
                            original_values = list(values) # 备份用于打印日志
                            current_len = len(values)

                            # === 情况 A: 数据过多，需要截断 ===
                            if current_len > target_len:
                                print(f"  [截断] 文件:{filename} | {item_name}-{move_name} | {cost_type}")
                                print(f"        Tier:{current_tier} -> 目标长度:{target_len} | 原: {original_values} -> 新: {values[:target_len]}")
                                costs[cost_type] = values[:target_len]
                                is_modified = True
                            
                            # === 情况 B: 数据过少，需要补全 (只要>=2个就能补) ===
                            elif current_len < target_len and current_len >= 2:
                                # 循环补全直到达到目标长度
                                temp_values = list(values)
                                while len(temp_values) < target_len:
                                    next_val = calculate_next_value(temp_values)
                                    if next_val is None:
                                        break
                                    temp_values.append(next_val)
                                
                                # 只有当成功补全到目标长度才应用修改
                                if len(temp_values) == target_len:
                                    print(f"  [补全] 文件:{filename} | {item_name}-{move_name} | {cost_type}")
                                    print(f"        Tier:{current_tier} -> 目标长度:{target_len} | 原: {original_values} -> 新: {temp_values}")
                                    costs[cost_type] = temp_values
                                    is_modified = True

            if is_modified:
                with open(file_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=4)
                print(f"  >>> 成功保存文件: {filename}\n")
            
        except json.JSONDecodeError:
            print(f"错误: 无法解析文件 {filename}，已跳过。")
        except Exception as e:
            print(f"处理文件 {filename} 时发生未知错误: {e}")

if __name__ == "__main__":
    fix_json_files()
    input("处理完成，按回车键退出...")
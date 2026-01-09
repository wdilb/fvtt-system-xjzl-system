import json
import os

def calculate_next_value(values):
    """
    根据前三个值计算等差数列的第四个值
    """
    if not isinstance(values, list) or len(values) != 3:
        return None
    # 确保列表里是数字
    if not all(isinstance(x, (int, float)) for x in values):
        return None

    # 计算差值 (第三个减第二个)
    diff = values[2] - values[1]
    next_val = values[2] + diff
    return next_val

def fix_json_files():
    current_dir = os.getcwd()
    json_files = [f for f in os.listdir(current_dir) if f.endswith('.json')]
    
    if not json_files:
        print("当前目录下没有找到json文件。")
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
                        # === 关键修改逻辑 ===
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

                        costs = move.get("costs", {})
                        move_name = move.get("name", "未知招式")
                        
                        # 遍历 costs 下的所有消耗类型
                        for cost_type in list(costs.keys()):
                            values = costs[cost_type]
                            
                            if not isinstance(values, list):
                                continue

                            # === 情况 1: 最终判定 Tier 为 3，补全到 4 个 ===
                            if current_tier == 3:
                                if len(values) == 3:
                                    next_val = calculate_next_value(values)
                                    if next_val is not None:
                                        print(f"  [补全] 文件:{filename} | {item_name}-{move_name} | {cost_type}")
                                        print(f"        Tier判定:{current_tier}(Move优先) | 原数据: {values} -> 增加: {next_val}")
                                        values.append(next_val)
                                        is_modified = True
                            
                            # === 情况 2: 最终判定 Tier 不是 3，截断为 3 个 ===
                            else:
                                if len(values) > 3:
                                    print(f"  [截断] 文件:{filename} | {item_name}-{move_name} | {cost_type}")
                                    print(f"        Tier判定:{current_tier}(Move优先) | 原数据: {values} -> 截断为: {values[:3]}")
                                    costs[cost_type] = values[:3]
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
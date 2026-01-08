import json
import os

def process_list(values):
    """
    根据前三个值计算等差数列的第四个值
    [a, b, c] -> d
    d = c + (c - b)
    """
    if not isinstance(values, list) or len(values) != 3:
        return None
    
    # 确保列表里是数字
    if not all(isinstance(x, (int, float)) for x in values):
        return None

    # 计算差值 (第三个减第二个)
    # 例子: [4, 8, 12] -> 12-8=4 -> 下一个 12+4=16
    # 例子: [6, 5, 4]  -> 4-5=-1 -> 下一个 4+(-1)=3
    # 例子: [0, 0, 0]  -> 0-0=0  -> 下一个 0
    diff = values[2] - values[1]
    next_val = values[2] + diff
    return next_val

def fix_json_files():
    current_dir = os.getcwd()
    json_files = [f for f in os.listdir(current_dir) if f.endswith('.json')]
    
    if not json_files:
        print("当前目录下没有找到json文件。")
        return

    print(f"找到 {len(json_files)} 个JSON文件，开始处理...")

    for filename in json_files:
        file_path = os.path.join(current_dir, filename)
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            is_modified = False
            
            # 遍历最外层的列表 (武学列表)
            if isinstance(data, list):
                for item in data:
                    # 检查是否存在 system 且 tier 为 3
                    system_data = item.get("system", {})
                    if system_data.get("tier") != 3:
                        continue
                    
                    moves = system_data.get("moves", [])
                    item_name = item.get("name", "未知武学")
                    
                    for move in moves:
                        costs = move.get("costs", {})
                        move_name = move.get("name", "未知招式")
                        
                        # 遍历 costs 下的所有消耗类型 (mp, rage, hp 等)
                        for cost_type, values in costs.items():
                            next_val = process_list(values)
                            
                            if next_val is not None:
                                # 执行修改
                                values.append(next_val)
                                is_modified = True
                                print(f"  [修改] 文件:{filename} | 武学:{item_name} | 招式:{move_name} | 消耗:{cost_type}")
                                print(f"        原数据: {values[:-1]} -> 新数据: {values}")

            # 如果文件有修改，则写回
            if is_modified:
                with open(file_path, 'w', encoding='utf-8') as f:
                    # ensure_ascii=False 保证中文正常显示, indent=4 保持美观
                    json.dump(data, f, ensure_ascii=False, indent=4)
                print(f"成功保存文件: {filename}\n")
            
        except json.JSONDecodeError:
            print(f"错误: 无法解析文件 {filename}，已跳过。")
        except Exception as e:
            print(f"处理文件 {filename} 时发生未知错误: {e}")

if __name__ == "__main__":
    fix_json_files()
    input("处理完成，按回车键退出...")
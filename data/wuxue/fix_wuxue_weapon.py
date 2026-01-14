import json
import os
import glob
import sys

def get_script_dir():
    """获取脚本文件所在的绝对路径，确保读取的是当前文件夹"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    else:
        return os.path.dirname(os.path.abspath(__file__))

def process_moves(moves_list):
    """
    处理招式列表，返回是否进行了修改
    """
    if not moves_list:
        return False

    # --- 1. 第一步：寻找基准 weaponType ---
    # 默认为 unarmed (对应情况1：都没写或全都没读取到)
    target_weapon_type = "unarmed"
    
    # 遍历寻找第一个有效的、非 none 的 weaponType
    for move in moves_list:
        wt = move.get("weaponType")
        # 如果存在且不为 none，则认定为该武学的基准类型
        if wt and wt != "none":
            target_weapon_type = wt
            break
            
    # --- 2. 第二步：应用修改 ---
    is_modified = False
    
    for move in moves_list:
        current_wt = move.get("weaponType")
        move_type = move.get("type")
        
        # 规则 1：如果没有 weaponType 字段，添加它
        if "weaponType" not in move:
            move["weaponType"] = target_weapon_type
            is_modified = True
            
        # 规则 2：如果是 qi (气招) 或 stance (架招)，且 weaponType 为 none，强制修改
        # 这里加入了 stance 的判断
        elif move_type in ["qi", "stance"] and current_wt == "none":
            move["weaponType"] = target_weapon_type
            is_modified = True
            
        # 其他情况（已有具体类型，或者非 qi/stance 招式的 none）不处理，保持原样

    return is_modified

def process_file(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ 读取文件出错 {os.path.basename(file_path)}: {e}")
        return

    # 确保数据是个列表
    if not isinstance(data, list):
        return

    file_modified = False

    for item in data:
        # 严格检查 system.category 是否为 wuxue
        # 只要 category 不是 wuxue，绝对不动
        system_data = item.get("system", {})
        if system_data.get("category") != "wuxue":
            continue

        # 获取 moves 列表
        moves = system_data.get("moves", [])
        if not isinstance(moves, list):
            continue

        # 处理招式
        if process_moves(moves):
            file_modified = True
            # 打印修改日志，方便查看
            print(f"  -> 修正武学: {item.get('name', '未命名')} (兵器类型统一为: {moves[0].get('weaponType', 'unknown')})")

    # 如果文件有变动，则写回
    if file_modified:
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                # ensure_ascii=False 保证中文字符显示正常
                # indent=4 保持美观的缩进
                json.dump(data, f, ensure_ascii=False, indent=4)
            print(f"✅ 已保存修改: {os.path.basename(file_path)}")
        except Exception as e:
            print(f"❌ 写入失败 {os.path.basename(file_path)}: {e}")

def main():
    # 获取脚本所在的目录
    current_dir = get_script_dir()
    print(f"正在扫描目录: {current_dir}")
    
    # 匹配该目录下所有的 json 文件
    search_pattern = os.path.join(current_dir, "*.json")
    json_files = glob.glob(search_pattern)
    
    if not json_files:
        print("⚠ 当前目录下没有找到 .json 文件。")
        return

    print(f"找到 {len(json_files)} 个 JSON 文件，开始处理...\n")
    
    for json_file in json_files:
        process_file(json_file)
        
    print("\n所有处理完成。")

if __name__ == "__main__":
    main()
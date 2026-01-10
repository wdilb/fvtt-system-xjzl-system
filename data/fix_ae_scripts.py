import os
import json
import re
from pypinyin import lazy_pinyin

# 配置日志颜色
class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'

def generate_slug(name):
    """
    将中文名称转换为拼音 slug (如 '威风' -> 'weifeng')
    """
    if not name:
        return "unnamed_effect"
    
    # 获取拼音列表
    pinyin_list = lazy_pinyin(name)
    slug = "".join(pinyin_list)
    
    # 移除非字母数字字符，替换为空或是下划线
    slug = re.sub(r'[^a-zA-Z0-9_]', '', slug)
    return slug.lower()

def fix_effect_object(effect, file_path):
    """
    修复单个 Effect 对象
    返回 True 如果发生了修改
    """
    modified = False
    
    # 检查是否存在根目录的 scripts
    if 'scripts' in effect:
        scripts_data = effect['scripts']
        effect_name = effect.get('name', 'Unknown Effect')
        
        print(f"{Colors.WARNING}  -> 发现错误位置的 Scripts: [{effect_name}]{Colors.ENDC}")
        
        # 1. 确保 flags 结构存在
        if 'flags' not in effect:
            effect['flags'] = {}
        
        if 'xjzl-system' not in effect['flags']:
            effect['flags']['xjzl-system'] = {}
            
        sys_flags = effect['flags']['xjzl-system']
        
        # 2. 检查或生成 Slug
        if 'slug' not in sys_flags or not sys_flags['slug']:
            new_slug = generate_slug(effect_name)
            sys_flags['slug'] = new_slug
            print(f"{Colors.OKBLUE}     生成 Slug: {new_slug}{Colors.ENDC}")
            modified = True
            
        # 3. 移动 Scripts
        # 如果 flags 里已经有了 scripts，我们要决定是覆盖还是合并
        # 通常错误的数据里 flags 里是没有 scripts 的，直接覆盖
        sys_flags['scripts'] = scripts_data
        
        # 4. 删除根目录 Scripts
        del effect['scripts']
        
        print(f"{Colors.OKGREEN}     已修复: Scripts 移至 flags.xjzl-system.scripts{Colors.ENDC}")
        modified = True
        
    return modified

def traverse_and_fix(data, file_path):
    """
    递归遍历 JSON 数据，寻找 "effects" 数组
    """
    modified = False
    
    if isinstance(data, dict):
        for key, value in data.items():
            # 只有 key 是 "effects" 且 value 是列表时，才视为 Active Effects 列表
            if key == "effects" and isinstance(value, list):
                for effect in value:
                    if isinstance(effect, dict):
                        if fix_effect_object(effect, file_path):
                            modified = True
            
            # 递归继续查找 (以防 Item 嵌套或其他结构)
            elif isinstance(value, (dict, list)):
                if traverse_and_fix(value, file_path):
                    modified = True
                    
    elif isinstance(data, list):
        for item in data:
            if traverse_and_fix(item, file_path):
                modified = True
                
    return modified

def process_file(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        is_modified = traverse_and_fix(data, file_path)
        
        if is_modified:
            print(f"正在保存文件: {file_path}")
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
            print("-" * 50)
            
    except json.JSONDecodeError:
        print(f"{Colors.FAIL}错误: 无法解析 JSON {file_path}{Colors.ENDC}")
    except Exception as e:
        print(f"{Colors.FAIL}处理文件 {file_path} 时出错: {str(e)}{Colors.ENDC}")

def main():
    root_dir = os.getcwd() # 获取当前脚本所在目录
    print(f"{Colors.HEADER}开始扫描目录: {root_dir}{Colors.ENDC}")
    print("=" * 50)
    
    count = 0
    for dirpath, dirnames, filenames in os.walk(root_dir):
        for filename in filenames:
            if filename.endswith('.json'):
                full_path = os.path.join(dirpath, filename)
                # 排除脚本自己生成的临时文件或非数据文件（可选）
                process_file(full_path)
                count += 1
                
    print("=" * 50)
    print(f"{Colors.HEADER}处理完成。扫描了 {count} 个文件。{Colors.ENDC}")

if __name__ == "__main__":
    main()
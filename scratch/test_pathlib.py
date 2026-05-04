from pathlib import Path
p = Path("/Users/dolpaks/.gemini/antigravity/skills/gstack")
print(f"Path: {p}")
print(f"Exists: {p.exists()}")
print(f"Is dir: {p.is_dir()}")
print(f"Is symlink: {p.is_symlink()}")

from pathlib import Path
import json

path = Path("manifest.json")
data = json.loads(path.read_text(encoding="utf-8"))

permissions = list(data.get("permissions") or [])
if "tabs" not in permissions:
    permissions.append("tabs")
data["permissions"] = permissions

hosts = list(data.get("host_permissions") or [])
hosts = ["https://api.kairox.su/*" if h == "https://api.finerox.online/*" else h for h in hosts]
if "https://api.kairox.su/*" not in hosts:
    hosts.insert(0, "https://api.kairox.su/*")
data["host_permissions"] = hosts

if data.get("name") == "Finerox — автоответы OZON":
    data["name"] = "Kairox — автоответы OZON"

action = data.get("action") or {}
if action.get("default_title") == "Finerox":
    action["default_title"] = "Kairox"
data["action"] = action

path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("manifest.json updated")

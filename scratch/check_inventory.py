import requests
import json

base_url = "http://localhost:8000/api"

def check_engine(engine):
    print(f"\n--- Checking Engine: {engine} ---")
    try:
        resp = requests.get(f"{base_url}/inventory?engine={engine}")
        if resp.status_code != 200:
            print(f"Error: {resp.status_code} - {resp.text}")
            return
        
        data = resp.json()
        skills = data.get("skills", [])
        agents = data.get("agents", [])
        
        print(f"Total Skills found: {len(skills)}")
        gstack_skills = [s for s in skills if "gstack" in s["name"].lower() or "autoplan" in s["name"].lower() or "qa" in s["name"].lower()]
        print(f"GStack-related Skills ({len(gstack_skills)}):")
        for s in gstack_skills[:10]:
            print(f"  - {s['name']} ({s['path']})")
        if len(gstack_skills) > 10:
            print("  ...")
            
        print(f"Total Agents found: {len(agents)}")
        gstack_agents = [a for a in agents if "gstack" in a["name"].lower()]
        print(f"GStack-related Agents ({len(gstack_agents)}):")
        for a in gstack_agents:
            print(f"  - {a['name']} (Status: {a['status']}, Reason: {a['reason']})")
            
    except Exception as e:
        print(f"Connection error: {e}")

if __name__ == "__main__":
    check_engine("gemini")
    check_engine("codex")

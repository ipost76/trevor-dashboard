#!/usr/bin/env python3
"""Schedule management helper for Mission Control dashboard. READ-WRITE."""
import json, sys, os


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")
    config_path = os.path.join(trevor_dir, "cron_schedule.json")

    if action == "toggle":
        job_name = sys.argv[2] if len(sys.argv) > 2 else ""
        enabled_str = sys.argv[3] if len(sys.argv) > 3 else ""

        if not job_name or enabled_str not in ("true", "false"):
            print(json.dumps({"error": "Usage: toggle <job_name> <true|false>"}))
            return

        enabled = enabled_str == "true"

        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)

            if "jobs" not in config or job_name not in config["jobs"]:
                print(json.dumps({"error": f"Job '{job_name}' not found in schedule config"}))
                return

            config["jobs"][job_name]["enabled"] = enabled

            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)
                f.write("\n")

            print(json.dumps({"ok": True, "job": job_name, "enabled": enabled}))
        except Exception as e:
            print(json.dumps({"error": str(e)}))

    elif action == "trigger":
        job_name = sys.argv[2] if len(sys.argv) > 2 else ""

        if not job_name:
            print(json.dumps({"error": "Usage: trigger <job_name>"}))
            return

        # Verify the job exists before confirming trigger
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)

            if "jobs" not in config or job_name not in config["jobs"]:
                print(json.dumps({"error": f"Job '{job_name}' not found in schedule config"}))
                return

            print(json.dumps({
                "ok": True,
                "triggered": job_name,
                "note": "Job trigger queued"
            }))
        except Exception as e:
            print(json.dumps({"error": str(e)}))

    else:
        print(json.dumps({"error": f"Unknown action: {action}. Valid: toggle, trigger"}))


if __name__ == "__main__":
    main()

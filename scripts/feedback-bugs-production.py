"""Read the production BUG queue through the existing Aliyun Cloud Assistant.

Uses the local Aliyun CLI profile. Database credentials remain on the server.
The remote script opens a READ ONLY transaction and has no write operations.
"""
import base64
import json
import os
import subprocess
import sys
import time

env = {k: v for k, v in os.environ.items()
       if k.lower() not in ("https_proxy", "http_proxy", "all_proxy")}


def api(*args):
    result = subprocess.run(
        ["aliyun", "ecs", *args, "--RegionId", "cn-wulanchabu",
         "--endpoint", "ecs.cn-wulanchabu.aliyuncs.com"],
        env=env, capture_output=True, text=True, timeout=45,
    )
    if result.returncode:
        raise RuntimeError("Aliyun request failed; check CLI login and connectivity.")
    return json.loads(result.stdout)


script = """set -eu
export PATH=/opt/node-v24.18.0-linux-x64/bin:$PATH
export DOTENV_CONFIG_QUIET=true
cd /opt/Drinking-Time
node --import tsx --input-type=module -e '
import "dotenv/config";
if (!process.env.DATABASE_URL) throw new Error("Production database is not configured");
process.env.FEEDBACK_DATABASE_URL = process.env.DATABASE_URL;
await import("./scripts/feedback-bugs.ts");
'
"""

try:
    invocation = api(
        "RunCommand", "--Type", "RunShellScript", "--ContentEncoding", "Base64",
        "--CommandContent", base64.b64encode(script.encode()).decode(),
        "--InstanceId.1", "i-0jl961d3z514yzk1x99f",
        "--Name", "drinking-time-read-feedback", "--Timeout", "60",
    )["InvokeId"]
    for _ in range(30):
        result = api("DescribeInvocationResults", "--InvokeId", invocation)
        rows = result.get("Invocation", {}).get("InvocationResults", {}).get("InvocationResult", [])
        if rows:
            row = rows[0]
            status = row.get("InvocationStatus")
            if status == "Success" and row.get("ExitCode") == 0:
                output = base64.b64decode(row.get("Output", "")).decode()
                # Drop any dotenv informational lines; only expose queue JSON.
                payload = json.loads(output[output.index("{"):])
                if not isinstance(payload.get("posts"), list):
                    raise RuntimeError("Production queue returned an invalid result.")
                print(json.dumps(payload, ensure_ascii=False, indent=2))
                break
            if status in ("Failed", "Stopped", "Timeout", "Invalid", "Terminated"):
                raise RuntimeError("Production queue unavailable; verify deployment and database. This is not an empty queue.")
        time.sleep(2)
    else:
        raise RuntimeError("Production queue read timed out. This is not an empty queue.")
except (RuntimeError, ValueError, KeyError, OSError, subprocess.TimeoutExpired) as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)

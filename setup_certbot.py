import subprocess
import os
import time
import signal
import sys

AUTH_HOOK = """#!/bin/bash
echo "Domain: ${CERTBOT_DOMAIN}" >> /root/certbot-challenge.txt
echo "Value: ${CERTBOT_VALIDATION}" >> /root/certbot-challenge.txt
echo "---" >> /root/certbot-challenge.txt
for i in $(seq 1 600); do
    if [ -f /root/certbot-signal ]; then
        rm -f /root/certbot-signal
        exit 0
    fi
    sleep 1
done
exit 0
"""

CLEANUP_HOOK = """#!/bin/bash
echo "Cleanup for ${CERTBOT_DOMAIN}" >> /root/certbot-challenge.txt
"""

with open('/root/auth-hook.sh', 'w') as f:
    f.write(AUTH_HOOK)
os.chmod('/root/auth-hook.sh', 0o755)

with open('/root/cleanup-hook.sh', 'w') as f:
    f.write(CLEANUP_HOOK)
os.chmod('/root/cleanup-hook.sh', 0o755)

for f in ['/root/certbot-challenge.txt', '/root/certbot-signal']:
    if os.path.exists(f):
        os.remove(f)

cmd = [
    'certbot', 'certonly',
    '--manual',
    '--preferred-challenges', 'dns',
    '--manual-auth-hook', '/root/auth-hook.sh',
    '--manual-cleanup-hook', '/root/cleanup-hook.sh',
    '-d', 'huaxianzi.vip',
    '-d', 'www.huaxianzi.vip',
    '--agree-tos',
    '-m', 'admin@huaxianzi.vip',
    '--manual-public-ip-logging-ok',
    '--non-interactive'
]

print("Starting certbot in background...")
process = subprocess.Popen(cmd, stdout=open('/root/certbot-output.txt', 'w'), stderr=subprocess.STDOUT)
print(f"Certbot PID: {process.pid}")

time.sleep(20)
print("\n--- Current challenge.txt content: ---")
if os.path.exists('/root/certbot-challenge.txt'):
    with open('/root/certbot-challenge.txt', 'r') as f:
        content = f.read()
        print(content)
        if not content.strip():
            print("(empty - certbot may not have reached the auth hook yet)")
else:
    print("(file doesn't exist yet)")

print("\n--- Certbot process status: ---")
if process.poll() is not None:
    print(f"Process exited with code: {process.returncode}")
    if os.path.exists('/root/certbot-output.txt'):
        print("Output:")
        with open('/root/certbot-output.txt', 'r') as f:
            print(f.read())
    print("\nProcess has exited. Check above for errors.")
    sys.exit(1)
else:
    print("Certbot is running and waiting for DNS signal.")
    print("Challenge values written to /root/certbot-challenge.txt")
    print("After DNS records are added, create /root/certbot-signal to continue.")
    print("(SIGTERM sent so process exits cleanly - re-run later)")
    process.terminate()
    try:
        process.wait(timeout=10)
    except:
        process.kill()

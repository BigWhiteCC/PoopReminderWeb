#!/usr/bin/expect -f
set timeout 300
set USER "root"
set HOST "39.97.255.11"
set PASSWORD "shit123."
set LOCAL_FILE "/Users/xk/Documents/Code/Daily/PoopReminderWeb/poopreminder-deploy.tar.gz"
set REMOTE_DIR "/opt/poopreminder"

puts "\n=== Step 1: Testing SSH connection ==="
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@$HOST "uname -a && echo SSH_OK"
expect {
    "*assword:" { send "$PASSWORD\r" }
    "*(yes/no)?*" { send "yes\r"; exp_continue }
    timeout { puts "TIMEOUT"; exit 1 }
}
expect {
    "SSH_OK" { puts "SSH OK"; exp_continue }
    "Permission denied" { puts "AUTH FAILED"; exit 1 }
    eof { puts "SSH test done" }
}

puts "\n=== Step 2: Uploading deploy package via SCP ==="
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $LOCAL_FILE $USER@$HOST:/tmp/
expect {
    "*assword:" { send "$PASSWORD\r" }
    "*(yes/no)?*" { send "yes\r"; exp_continue }
    timeout { puts "SCP TIMEOUT"; exit 1 }
}
expect eof
puts "SCP upload done"

puts "\n=== Step 3: Deploying on server ==="
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@$HOST "mkdir -p $REMOTE_DIR && cd /tmp && tar xzf poopreminder-deploy.tar.gz -C $REMOTE_DIR && ls -la $REMOTE_DIR && echo DEPLOY_EXTRACT_OK"
expect {
    "*assword:" { send "$PASSWORD\r" }
    "*(yes/no)?*" { send "yes\r"; exp_continue }
    timeout { puts "DEPLOY TIMEOUT"; exit 1 }
}
expect {
    "DEPLOY_EXTRACT_OK" { puts "Extract OK"; exp_continue }
    eof { puts "Deploy extract done" }
}

puts "\n=== Step 4: Checking Node.js and installing dependencies ==="
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@$HOST "node -v || echo NODE_MISSING; cd $REMOTE_DIR && ls package.json && echo PKG_OK"
expect {
    "*assword:" { send "$PASSWORD\r" }
    "*(yes/no)?*" { send "yes\r"; exp_continue }
    timeout { puts "TIMEOUT"; exit 1 }
}
expect {
    "PKG_OK" { puts "Package.json OK"; exp_continue }
    eof { puts "Node check done" }
}

puts "\n=== Step 5: Installing npm dependencies ==="
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@$HOST "cd $REMOTE_DIR && npm install --production 2>&1 | tail -20 && echo NPM_INSTALL_DONE"
expect {
    "*assword:" { send "$PASSWORD\r" }
    "*(yes/no)?*" { send "yes\r"; exp_continue }
    timeout { puts "NPM TIMEOUT"; exit 1 }
}
expect {
    "NPM_INSTALL_DONE" { puts "NPM install OK"; exp_continue }
    eof { puts "NPM step done" }
}

puts "\n=== Step 6: Stopping old process and starting new one ==="
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@$HOST "pkill -f 'node $REMOTE_DIR/index.js' 2>/dev/null; sleep 1; cd $REMOTE_DIR && nohup node index.js > app.log 2>&1 & sleep 3; ps aux | grep -v grep | grep 'node.*index.js' && echo START_OK || echo START_FAIL"
expect {
    "*assword:" { send "$PASSWORD\r" }
    "*(yes/no)?*" { send "yes\r"; exp_continue }
    timeout { puts "START TIMEOUT"; exit 1 }
}
expect {
    "START_OK" { puts "App started OK"; exp_continue }
    "START_FAIL" { puts "App start FAILED"; exp_continue }
    eof { puts "Start step done" }
}

puts "\n=== Step 7: Verifying HTTP response ==="
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@$HOST "sleep 2 && curl -s -o /dev/null -w 'HTTP:%{http_code}\n' http://localhost:3000/ || echo CURL_FAIL"
expect {
    "*assword:" { send "$PASSWORD\r" }
    "*(yes/no)?*" { send "yes\r"; exp_continue }
    timeout { puts "VERIFY TIMEOUT"; exit 1 }
}
expect eof

puts "\n=== ALL DONE ==="

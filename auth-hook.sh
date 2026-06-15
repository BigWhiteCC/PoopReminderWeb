#!/bin/bash
echo "Domain: ${CERTBOT_DOMAIN}" >> /root/certbot-challenge.txt
echo "Value: ${CERTBOT_VALIDATION}" >> /root/certbot-challenge.txt
echo "---" >> /root/certbot-challenge.txt
for i in $(seq 1 300); do
    if [ -f /root/certbot-signal ]; then
        rm -f /root/certbot-signal
        exit 0
    fi
    sleep 1
done
exit 0
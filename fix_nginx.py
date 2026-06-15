import re

with open('/etc/nginx/nginx.conf', 'r') as f:
    content = f.read()

new_server_block = """    server {
        listen       80;
        listen       [::]:80;
        server_name  huaxianzi.vip www.huaxianzi.vip;
        client_max_body_size 10m;

        location ^~ /.well-known/acme-challenge/ {
            allow all;
            root /usr/share/nginx/html;
        }

        location / {
            proxy_pass http://127.0.0.1:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }"""

pattern = r'    server \{.*?    \}'
content_new = re.sub(pattern, new_server_block, content, count=1, flags=re.DOTALL)

with open('/etc/nginx/nginx.conf', 'w') as f:
    f.write(content_new)

print('Nginx config updated successfully')

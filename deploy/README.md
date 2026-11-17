# StudyPilot 阿里云 Ubuntu 上线手册

目标环境：阿里云轻量应用服务器，Ubuntu 24.04，2 核 2G，项目根目录 `/srv/studypilot`。

前端在本地构建，服务器只运行 Nginx + FastAPI + SQLite。**不要在 2G 服务器上执行 `npm run build`。**

## 1. 服务器初始化

在阿里云控制台放行 `22`、`80`、`443`；如启用了 UFW：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

安装系统依赖并创建运行账号：

```bash
sudo apt update
sudo apt install -y nginx python3-venv python3-pip sqlite3
sudo adduser --system --group --home /srv/studypilot studypilot
sudo mkdir -p /srv/studypilot/backend /srv/studypilot/frontend /srv/studypilot/data
sudo chown -R studypilot:studypilot /srv/studypilot
# adduser 创建的家目录默认 750，Nginx 的 www-data 无法穿过；静态目录父级必须可读可执行
sudo chmod 755 /srv/studypilot
```

## 2. 本地打包并上传

在本地仓库根目录执行；把 `USER`、`SERVER_IP` 换成服务器 SSH 账号和公网 IP：

```bash
# 前端：先本地构建
cd frontend
npx vite build
cd ..

# 后端与运行所需数据
tar -czf /tmp/studypilot-backend.tgz \
  backend/app backend/alembic backend/alembic.ini \
  backend/requirements.txt backend/.env.example backend/.env.billing.example \
  backend/scripts/seed_review_user.py \
  data deploy

scp /tmp/studypilot-backend.tgz USER@SERVER_IP:/tmp/
ssh USER@SERVER_IP "sudo tar -xzf /tmp/studypilot-backend.tgz -C /srv/studypilot && sudo chown -R studypilot:studypilot /srv/studypilot"

# 前端产物
tar -C frontend -czf /tmp/studypilot-frontend.tgz dist
scp /tmp/studypilot-frontend.tgz USER@SERVER_IP:/tmp/
ssh USER@SERVER_IP "sudo tar -xzf /tmp/studypilot-frontend.tgz -C /srv/studypilot/frontend && sudo chmod -R a+rX /srv/studypilot/frontend/dist"

# 预压缩 Rive 资源，避免 Nginx 每次动态压缩 wasm
ssh USER@SERVER_IP "sudo find /srv/studypilot/frontend/dist -type f \\( -name '*.wasm' -o -name '*.riv' \\) -exec gzip -9 -kf {} \\;"
```

## 3. 后端虚拟环境与配置

```bash
sudo -u studypilot -H bash
cd /srv/studypilot/backend
python3 -m venv .venv
.venv/bin/pip install -U pip
.venv/bin/pip install -r requirements.txt
cp .env.example .env
chmod 600 .env

# 生成 AES_KEY
.venv/bin/python -c "import base64,os;print(base64.b64encode(os.urandom(32)).decode())"
```

编辑 `/srv/studypilot/backend/.env`：

```dotenv
DATABASE_URL=sqlite:////srv/studypilot/backend/studypilot.db
DB_PASSWORD=
AES_KEY=<上一步生成的值>
SESSION_TIMEOUT_MINUTES=30
```

需要平台积分演示时，再按 `DEPLOY.md` 追加 `CREDITS_*` 和 `BILLING_*` 配置。真实 API Key 只放服务器 `.env`，不要提交 Git，也不要发到聊天里。

执行迁移：

```bash
cd /srv/studypilot/backend
.venv/bin/alembic upgrade head
```

如需创建评审账号：

```bash
.venv/bin/python -m scripts.seed_review_user
```

> 该脚本创建 `super / StudyPilot2026!`，不会重置已有账号密码。公开上线时不要长期保留默认密码；至少先确认登录入口只对评委开放，或改为私有演示账号。

退出 `studypilot` shell，回到有 sudo 权限的账号。

### 迁移已有本机数据库（保留账号和演示记录）

先备份线上库，再替换。**必须沿用原数据库的 `AES_KEY`**，否则用户已保存的 API Key 无法解密：

```bash
sudo systemctl stop studypilot
cd /srv/studypilot/backend
sudo -u studypilot sqlite3 studypilot.db \
  ".backup '/srv/studypilot/backups/before-migration-$(date +%F-%H%M).db'"

# 上传本机数据库到 /tmp/studypilot-local.db 后
sudo cp /tmp/studypilot-local.db studypilot.db
sudo chown studypilot:studypilot studypilot.db
sudo chmod 600 studypilot.db
sudo rm -f .sessions.json .sessions.json.tmp
sudo -u studypilot .venv/bin/alembic upgrade head
sudo systemctl start studypilot
```

迁移后保留原 `super` 账号密码，不要再执行种子脚本覆盖数据。核对：

```bash
sudo -u studypilot sqlite3 studypilot.db \
  "select count(*) from users; select count(*) from plans; select count(*) from check_ins;"
```

## 4. 启动后端

```bash
sudo cp /srv/studypilot/deploy/studypilot.service /etc/systemd/system/studypilot.service
sudo systemctl daemon-reload
sudo systemctl enable --now studypilot
sudo systemctl status studypilot --no-pager
curl http://127.0.0.1:8000/health
```

必须保持 **单 worker**：当前 session 存在进程内和 `.sessions.json`，SQLite 也不适合多进程并发写。

查看日志：

```bash
journalctl -u studypilot -f
```

## 5. 配置 Nginx

```bash
sudo cp /srv/studypilot/deploy/nginx-studypilot.conf /etc/nginx/sites-available/studypilot
sudo ln -sf /etc/nginx/sites-available/studypilot /etc/nginx/sites-enabled/studypilot
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

浏览器访问 `http://服务器公网IP`，检查：

- `/` 首页正常
- `/health` 返回 `{"status":"ok"}`
- 登录、上传资料、AI 对话
- `/zh` 简历编辑器可打开

## 6. 域名与 HTTPS

### 6.1 当前状态：公网 IP 的 HTTPS（已上线）

Let's Encrypt 自 2026 年起支持 IP 地址证书（`shortlived` 配置，有效期约 6 天）。当前服务器已用它启用 `https://8.137.203.9`，并配置了自动续期，因此浏览器把站点视为安全上下文，简历的"选择本地目录"和错题本的"拍照识题"（`getUserMedia`）才能使用。

证书路径：`/etc/letsencrypt/live/8.137.203.9/`，Nginx 已在 443 上启用，80 端口只保留 ACME 挑战并 301 跳转。

续期（cron 每天 03:17、15:17）：

```bash
/opt/certbot/bin/certbot renew --quiet --deploy-hook "systemctl reload nginx"
```

手动检查与演练：

```bash
/opt/certbot/bin/certbot certificates
/opt/certbot/bin/certbot renew --dry-run
```

注意：IP 证书只有约 6 天有效期。若 `certbot` 续期连续失败，证书过期后浏览器会拒绝 https 访问。排查顺序：`/var/log/letsencrypt-renew.log`、`/var/log/letsencrypt/letsencrypt.log`、80 端口是否仍放行。

### 6.2 换成域名后（推荐，需 ICP 备案）

中国内地服务器绑定域名对外提供网站服务前需要 ICP 备案。备案完成后：

```bash
sudo apt install -y certbot
sudo certbot certonly --webroot -w /var/www/certbot -d your-domain.example
```

然后把 `nginx-studypilot.conf` 中 443 段的 `server_name` 改为域名、证书路径改为 `/etc/letsencrypt/live/your-domain.example/`，`nginx -t && systemctl reload nginx`。域名证书有效期 90 天，续期压力小得多。

## 7. 备份

SQLite 必须用 `.backup`，不要直接复制正在写入的数据库：

```bash
sudo mkdir -p /srv/studypilot/backups
sudo sqlite3 /srv/studypilot/backend/studypilot.db \
  ".backup '/srv/studypilot/backups/studypilot-$(date +%F-%H%M).db'"
```

建议加入每日 cron，并把备份下载到本地一份。服务器到期、重置系统或误删数据库都可以用备份恢复。

## 8. 语音功能（可选）

`/speech` 目录和 `.venv-edge` 不是主站运行必需。启用前安装：

```bash
cd /srv/studypilot/speech
python3 -m venv .venv-edge
.venv-edge/bin/pip install -r requirements.txt
```

语音依赖外部 Edge TTS，且会额外占用内存；2G 机器比赛演示若不需要朗读，可以先不启用。

## 9. 更新发布

```bash
# 本地重新构建后上传 dist
npx vite build
tar -C frontend -czf /tmp/studypilot-frontend.tgz dist
scp /tmp/studypilot-frontend.tgz USER@SERVER_IP:/tmp/
ssh USER@SERVER_IP "sudo tar -xzf /tmp/studypilot-frontend.tgz -C /srv/studypilot/frontend && sudo chmod -R a+rX /srv/studypilot/frontend/dist"

# 后端有代码或迁移变更时，上传对应文件后
ssh USER@SERVER_IP "cd /srv/studypilot/backend && .venv/bin/alembic upgrade head && sudo systemctl restart studypilot"
```
